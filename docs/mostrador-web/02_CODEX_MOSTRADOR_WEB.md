# 02 — `mostrador.html`: el Mostrador Web

> Repo: `Loyalty-Web` · Ejecuta: **Codex** · Lee primero `00_CONTEXTO.md`
> Depende de: doc 01 (`POST /mostrador/pair`). Se puede empezar contra un stub, no se puede probar de punta a punta sin él.

Construir **un solo archivo**, `mostrador.html`, autocontenido, sin build step, siguiendo el patrón exacto de `loyalty-pass.html`: `<style>` inline con las variables CSS de `BRAND.md`, `<script>` inline, `window.COPO_API_BASE` con default `https://api-loyalty.copopos.com`.

**Única excepción a "sin dependencias":** el decodificador de QR de fallback (§4). Va **vendorizado** en `assets/`, nunca desde un CDN.

---

## 1. Modelo mental

La página es una carcasa tonta sobre `/api/v1/loyalty/pos/*`. **Cero lógica de negocio local**: no calcula visitas, no decide si hay premio, no aplica límites. Pregunta y muestra.

Tres pantallas, un solo estado global:

```
  no emparejado  ──(código de 8 dígitos)──▶  listo  ──(escaneo/teléfono)──▶  cliente
                                              ▲                                │
                                              └──── timeout N s / "Terminar" ◀──┘
```

---

## 2. Pantalla A — Emparejar

Se muestra si no hay `deviceToken` en `localStorage`.

- Logo Copo, título "Conecta este teléfono".
- Texto: *"Pide a tu administrador el código de 6-10 min en el dashboard: Ajustes → Dispositivos de mostrador."*
- Un input numérico de 8 dígitos (`inputmode="numeric"`, `autocomplete="one-time-code"`, `maxlength="8"`) y un input opcional de nombre del dispositivo (default: `"Teléfono"`).
- Botón "Conectar" → `POST /api/v1/integrations/pos/mostrador/pair` con `{ code, label }`.
- En éxito: guardar en `localStorage` bajo la clave `copo_mostrador_v1`:
  ```json
  { "deviceToken": "...", "deviceId": "...", "merchantName": "...", "sessionSeconds": 90, "programId": null }
  ```
- Si la URL trae `#code=04831927`, pre-llenar el input (conveniencia del QR del dashboard). **Limpiar el hash inmediatamente** con `history.replaceState` para que el código no quede en el historial del navegador.
- Errores: `INVALID_OR_EXPIRED_CODE` → "Código inválido o expirado. Pide uno nuevo." Cualquier otro → mensaje del backend.

---

## 3. Pantalla B — Listo para escanear

Se muestra con `deviceToken` presente y sin cliente en sesión.

**Al montar** (una vez, cacheado en memoria): `GET /api/v1/loyalty/pos/programs`.
- 0 programas → estado vacío: "No hay un programa activo. Configúralo en el dashboard."
- 1 programa → seleccionado automáticamente.
- 2+ → chips horizontales para elegir; persistir la elección en `localStorage.programId`.

**Elementos:**

1. **Botón primario grande "Escanear QR"** — ocupa la mayor parte de la pantalla, target táctil ≥ 56 px. Abre el escáner (§4).
2. **Alternativa plegada**: "El cliente no trae su tarjeta" → despliega teléfono (10 dígitos) + código rotativo de 6 dígitos del pass.
   ⚠️ Ese código de 6 dígitos **es el OTP del pass, NO el PIN del cliente**. Copiar la nota que ya usa la app (`mostrador.tsx`, bloque `Smartphone`): *"El código de 6 dígitos aparece en el pass del cliente (Wallet), no es su PIN."* Confundirlos genera tickets de soporte.
3. Header discreto: nombre del negocio + punto verde/rojo de `navigator.onLine`.
4. Menú (icono ⚙) → "Desvincular este teléfono": borra `localStorage` y vuelve a la pantalla A.

**Ambas rutas llaman al mismo endpoint:**

```http
POST /api/v1/loyalty/pos/lookup
x-loyalty-device-token: <token>
Content-Type: application/json

{ "programId": "...", "qrToken": "copo_loyalty:<id>:<otp>" }
      — o —
{ "programId": "...", "phone": "9991234567", "passOtp": "483920" }
```

Respuesta relevante:

```jsonc
{ "data": {
  "customer": {
    "id", "name", "phone", "visitsCount",
    "hasPendingReward", "pendingRewardDescription", "tierName",
    "visitsToday", "dailyLimitReached"   // solo si Bernardo implementó §4 del doc 01
  },
  "verificationMethod": "qr_scan" | "pass_otp",
  "verificationGrant": "<token de un solo uso>"
} }
```

Errores a traducir a español llano, sin códigos crudos:

| code | mensaje en pantalla |
|---|---|
| `CUSTOMER_NOT_FOUND` | "Este cliente no está registrado. Compártele el QR de registro del programa." |
| `INVALID_QR` | "El código expiró. Pide al cliente que abra su tarjeta otra vez." |
| `INVALID_OTP` | "Código incorrecto o expirado." |
| `UNAUTHORIZED` | "Este teléfono ya no está autorizado." → forzar pantalla A |

---

## 4. El escáner de cámara — la parte que hay que hacer bien

**Requisitos duros. Si alguno falta, no funciona en algún dispositivo real.**

### 4.1 Contexto seguro

`getUserMedia` solo existe bajo HTTPS (o `localhost`). Si `!navigator.mediaDevices?.getUserMedia`, mostrar el fallback de teléfono+OTP con una explicación, **no** un error genérico.

### 4.2 Arranque

Solo desde un tap del usuario — iOS lo exige y evita pedir permiso al cargar la página.

```js
const stream = await navigator.mediaDevices.getUserMedia({
  video: {
    facingMode: { ideal: 'environment' },
    width:  { ideal: 1280 },
    height: { ideal: 720 },
  },
  audio: false,
});
```

El `<video>` **debe** llevar `playsinline muted autoplay` como atributos. Sin `playsinline`, iOS abre el reproductor nativo a pantalla completa y se pierde el overlay.

Manejar `NotAllowedError` (permiso denegado) y `NotFoundError` (sin cámara) con mensajes distintos. En permiso denegado, decir cómo revertirlo: *"Actívala en la barra de direcciones del navegador"*.

### 4.3 Decodificación en dos niveles (D4 del contexto — no negociable)

```js
if ('BarcodeDetector' in window) {
  const supported = await BarcodeDetector.getSupportedFormats();
  if (supported.includes('qr_code')) { /* nivel 1: nativo */ }
}
// nivel 2: fallback vendorizado
```

**Fallback:** `jsQR` (MIT, ~45 KB minificado, JS puro, sin wasm) vendorizado en `assets/jsqr.min.js`. Alternativa si se prefiere más velocidad: `zxing-wasm`, pero pesa más y añade un `.wasm` que servir. Para leer un QR a 15 cm, jsQR sobra.

**No usar un CDN.** Rompe el principio de "archivos autocontenidos" del repo y añade un punto de fallo con red mala, que es justo el escenario de uso.

### 4.4 Loop

- `video.requestVideoFrameCallback()` si existe; si no, `requestAnimationFrame`.
- **Downscale antes de decodificar**: pintar a un `<canvas>` de ~480 px de ancho. Decodificar 1280×720 crudo tira los fps en gama media.
- Throttle a ~10 intentos/segundo. Más no ayuda y calienta el teléfono.
- Guard de duplicados: ignorar un payload idéntico al anterior dentro de 3 s.
- Validar antes de mandar nada al backend: `data.startsWith('copo_loyalty:')` y `data.split(':').length === 3`. Es la misma validación de `QrScannerModal.tsx` y `UsbScannerInput.tsx`. Un QR ajeno se ignora en silencio, no da error.

### 4.5 Apagar la cámara

```js
stream.getTracks().forEach(t => t.stop());
```

Al cerrar el escáner, al identificar al cliente, en `visibilitychange` cuando la página pasa a oculta, y en `pagehide`. **Si esto se olvida, la cámara queda encendida quemando batería y el LED prendido** — el cliente lo nota y se ve muy mal.

### 4.6 Selector de cámara (riesgo #2 del contexto)

Botón discreto "Cambiar cámara": `navigator.mediaDevices.enumerateDevices()` filtrando `kind === 'videoinput'`, y rotar entre ellas con `deviceId: { exact }`. Recordar la elegida en `localStorage`.

Sin esto, en varios Android `environment` cae en la lente ultra-gran-angular, que no enfoca a 10 cm: la cámara se ve bien, nunca lee el QR, y parece un bug del escáner.

### 4.7 Nice-to-have

Linterna, si el track la soporta: `track.applyConstraints({ advanced: [{ torch: true }] })` — envolver en try/catch, muchos dispositivos lo rechazan.

---

## 5. Pantalla C — Cliente identificado

Se muestra tras un `lookup` exitoso.

**Contenido, en este orden de peso visual:**

1. Nombre del cliente, grande.
2. **Premio pendiente** — si `hasPendingReward`: tarjeta ámbar (`--amber: #D97706`) con `pendingRewardDescription`. Es lo más importante de la pantalla; si el cajero no lo ve, el cliente no recibe su premio.
3. Progreso de visitas: `visitsCount / visitsTarget` (el target sale de `program.visitsConfig.visitsTarget` de `/pos/programs`) + barra. Si no hay `visitsConfig`, mostrar solo el número.
4. **Botón primario "Confirmar visita"**.
5. Si `hasPendingReward`: botón secundario ámbar "Entregar premio".
6. Contador "Termina en Ns" + botón "Terminar".

### 5.1 Confirmar visita

```http
POST /api/v1/loyalty/pos/accumulate
x-loyalty-device-token: <token>

{
  "eventUuid": "<uuid v4>",
  "programId": "...",
  "cardCustomerId": "<customer.id>",
  "amountCents": 0,
  "orderId": "mostrador-web-<timestamp>",
  "branchId": "<merchantId o primaryLocationId>",
  "cashierId": "<deviceId>",
  "deviceId": "<deviceId>",
  "verificationMethod": "<el que devolvió el lookup>",
  "verificationGrant": "<el que devolvió el lookup>"
}
```

**Reglas que no se pueden saltar:**

- **`eventUuid` se genera con `crypto.randomUUID()` al recibir la respuesta del lookup, NO al pulsar el botón.** Se conserva hasta que la llamada tenga éxito. Así un doble tap o un reintento por red mala no crean dos visitas — el backend deduplica por `eventUuid` (`transaction.service.ts:41`). Generarlo en el click anula la idempotencia.
- El botón se deshabilita mientras la llamada está en vuelo.
- `verificationMethod` debe ser **exactamente** el que devolvió el lookup. Si no coincide, el grant no se consume y sale `VERIFICATION_FAILED`.
- El `verificationGrant` es de un solo uso: tras un `accumulate` exitoso, el botón ya no vuelve a estar disponible en esa sesión.
- `cashierId: deviceId` — así el reporte semanal de anomalías (`antifraud.service.ts`) puede distinguir teléfonos. Si todos mandan la misma cadena, la detección de "acumulaciones desde >2 dispositivos" queda ciega.

**Errores:**

| status / code | mensaje |
|---|---|
| 429 `DAILY_LIMIT_REACHED` | "Este cliente ya registró su visita de hoy." — no es un error del cajero, tono neutro |
| `VERIFICATION_FAILED` | "La verificación expiró. Escanea otra vez." → volver a pantalla B |
| red caída | "Sin conexión. El Mostrador Web necesita internet para registrar visitas." |

Si el backend implementó `dailyLimitReached` (doc 01 §4), **deshabilitar el botón desde el inicio** con la leyenda de arriba, en vez de dejar que falle.

**Respuesta exitosa** → actualizar `visitsCount` con el valor que devuelve el backend (no incrementar en local) y, si `rewardUnlocked`, mostrar la tarjeta de premio pendiente sin recargar.

### 5.2 Entregar premio

```http
POST /api/v1/loyalty/pos/claim-reward
{ "programId", "cardCustomerId", "branchId", "cashierId" }
```

Confirmación de un paso ("¿Entregar *&lt;descripción&gt;*?" → Sí/Cancelar): es irreversible desde esta pantalla. Tras el éxito, feedback verde 2 s y cerrar sesión automáticamente.

### 5.3 Timer de sesión

`sessionSeconds` del emparejamiento (default 90). Cuenta atrás; al llegar a 0 vuelve a la pantalla B y **borra de memoria todo lo del cliente**. Cualquier toque en la pantalla reinicia el contador (igual que `bump()` en `mostrador.tsx:112`).

Es una medida de privacidad, no de comodidad: el teléfono se queda en el mostrador y nadie tiene que ver el nombre y las visitas del cliente anterior.

---

## 6. Almacenamiento y seguridad

**En `localStorage` (clave `copo_mostrador_v1`), solo esto:**
`deviceToken`, `deviceId`, `merchantName`, `sessionSeconds`, `programId`, `cameraDeviceId`.

**Nunca en `localStorage`:** `verificationGrant`, nombre/teléfono/`id` del cliente, `qrToken`. Todo eso vive en una variable de JS y se limpia al cerrar la sesión del cliente.

Envolver cada lectura/escritura en `try/catch`: en modo privado de iOS `localStorage` puede lanzar, y la página tiene que seguir funcionando (pidiendo el código otra vez).

Ante cualquier `401 UNAUTHORIZED` de la API: borrar el storage y volver a la pantalla A. Significa que el dueño revocó el dispositivo.

---

## 7. PWA — sí, pero mínima

- `manifest.webmanifest`: `name: "Copo Mostrador"`, `display: "standalone"`, `theme_color: "#2563EB"`, `background_color: "#F7F9FC"`, íconos de `assets/`.
- `<meta name="apple-mobile-web-app-capable" content="yes">` y `<link rel="apple-touch-icon">`.
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` + `padding-bottom: env(safe-area-inset-bottom)` para el notch.
- **Sin service worker en v1** (D5 del contexto). No es pereza: un SW mal versionado sirve HTML viejo indefinidamente y es carísimo de diagnosticar en casa de un cliente.

---

## 8. Criterios de aceptación

Ninguno de estos se marca por lectura de código; hay que ejecutarlos.

- [ ] **En un iPhone real, Safari**: escanea un pass y registra la visita. *(Es el caso que revienta si se implementa solo `BarcodeDetector`.)*
- [ ] **En un Android real, Chrome**: idem, incluyendo un dispositivo con varias cámaras traseras.
- [ ] Doble tap rápido en "Confirmar visita" → **una** sola visita en el backend.
- [ ] Cerrar el escáner apaga el LED de la cámara.
- [ ] Cambiar a otra app y volver: la cámara no quedó corriendo en segundo plano.
- [ ] Con el dispositivo revocado desde el dashboard, la siguiente acción manda al usuario a la pantalla de emparejamiento.
- [ ] Cliente que ya visitó hoy → mensaje claro, no un error crudo.
- [ ] Modo avión → mensaje de "sin conexión", no un spinner infinito.
- [ ] La página completa (sin contar el jsQR vendorizado) pesa menos de 100 KB.
- [ ] Funciona en horizontal y en vertical.

---

## 9. Fuera de alcance en v1

Puntos, catálogo de recompensas, canje, registro de clientes nuevos (eso es `loyalty-join.html`), historial de transacciones, funcionamiento offline, multi-sucursal.
