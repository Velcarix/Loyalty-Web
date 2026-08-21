# Mostrador Web — Contexto y arquitectura

> Fecha: 2026-08-21 · Estado: spec aprobado, listo para implementar
> Este documento es la fuente de verdad. Los docs 01/02/03 son las instrucciones ejecutables por repo.

---

## 1. Qué se construye y por qué

Hoy un negocio necesita **hardware** para operar Copo Loyalty en caja:

| Dispositivo | Cómo identifica al cliente | Dónde vive |
|---|---|---|
| Celular / tablet Android o iOS | Cámara nativa (`expo-camera`) | App Copo Loyalty (stores) |
| PC / Windows | Lector USB tipo *keyboard wedge* | Expo web + Electron |

El hueco: **un negocio sin lector USB y sin la app instalada no puede escanear nada**. En la práctica es el caso más común de un piloto — el dueño quiere probar hoy, con el celular que trae en la bolsa, sin instalar nada.

**Mostrador Web** cierra ese hueco: una página web que se abre en el navegador del celular, usa la cámara como escáner, y muestra lo mismo que muestra la app.

### Alcance de v1 (decidido 2026-08-21)

Escanear → ver quién es y si tiene **premio pendiente** → **confirmar visita** → (si aplica) entregar premio.

**Fuera de v1:** puntos, catálogo de recompensas y canje. El canje sigue viviendo en el checkout del POS (decisión de producto vigente).

---

## 2. Lo que YA existe (no reconstruir nada de esto)

Auditado leyendo el código el 2026-08-21. Rutas relativas a `Loyalty-app/`.

### Backend — `backend/src/`

Todo el motor que necesita el Mostrador Web **ya está construido y desplegado**:

- `POST /api/v1/loyalty/pos/lookup` — acepta `{programId, qrToken}` **o** `{programId, phone, passOtp}`. Valida el TOTP del QR, devuelve el cliente completo (`visitsCount`, `hasPendingReward`, `pendingRewardDescription`, `tierName`, ...) **y un `verificationGrant`** de un solo uso, TTL 24 h.
  → `routes/pos.ts:125`
- `POST /api/v1/loyalty/pos/accumulate` — suma la visita. Idempotente por `eventUuid`. Exige el `verificationGrant`.
- `POST /api/v1/loyalty/pos/claim-reward` — entrega el premio pendiente y resetea el contador.
- `GET /api/v1/loyalty/pos/programs` — programas del merchant con su config.

### Auth de dispositivo — ya existe el mecanismo correcto

`MostradorDeviceToken` (`prisma/schema.prisma:56`) + `mostrador-device-auth.middleware.ts`: un token por dispositivo, **acotado a `/pos/*`**, enviado en el header `x-loyalty-device-token`, revocable, con `lastUsedAt`. Es exactamente la credencial que debe tener un teléfono en mostrador: no puede leer analytics, ni editar programas, ni tocar el perfil del merchant. Solo sumar visitas y entregar premios.

Lo que **falta** es la forma de emitirlo sin el JWT de merchant → ver doc 01.

### Formato del QR — `services/totp.service.ts`

```
copo_loyalty:<customerId>:<totp6>
```

TOTP con `step: 30, window: 1` → el código de un pass es válido ~30-60 s. El secreto vive en `LoyaltyPass.totpSecret`. **El QR rota**: no sirve una foto vieja del pass. Esto es una propiedad de seguridad real y el frontend no debe hacer nada que la rompa (por ejemplo: no cachear `qrToken` para reintentos).

### CORS — ya cubierto

`backend/src/server.ts:50` acepta cualquier `origin.endsWith('.copopos.com')`. Si el Mostrador Web se sirve en `mostrador.copopos.com`, **no hay que tocar CORS**. Si se sirve en otro dominio, sí.

### Página del cliente — `Loyalty-Web/loyalty-pass.html`

Ya existe una web autocontenida (21 KB, sin build step, sin dependencias) que habla con `loyalty-api` vía `window.COPO_API_BASE`. **Ese es el patrón exacto a copiar** para `mostrador.html`.

---

## 3. Decisiones de arquitectura

### D1 — Vive en `Loyalty-Web`, como página estática

`Loyalty-Web/mostrador.html`, mismo patrón que `loyalty-pass.html`: un solo archivo, sin build, servido en cualquier hosting estático.

**Por qué, y qué se pierde.** La alternativa era activar la cámara en el Expo web que ya existe (`app/(main)/mostrador.tsx` ya corre en web; solo tiene la cámara deshabilitada a propósito) y reusar el 100% de la pantalla. Se descartó por peso: el bundle de Expo web son varios MB contra ~60 KB de un HTML plano, y el escenario de uso es un celular gama media con datos móviles abriendo la página delante de un cliente que está esperando. **El costo real de esta decisión es duplicación de UI: hay dos Mostradores que mantener en sincronía.** Cuando se cambie el flujo en uno, hay que cambiarlo en el otro o documentar por qué divergen. Está asumido conscientemente.

### D2 — Emparejamiento por código de 8 dígitos desde el dashboard

El dueño genera un código en el dashboard → el cajero lo teclea en el celular → el celular recibe **su propio** `MostradorDeviceToken`.

**Por qué:** nadie teclea la contraseña del dueño en un celular compartido, y cada teléfono es revocable por separado. Además ya existe el patrón idéntico para vincular el POS (`PosLinkCode` + `POST /integrations/pos/link`), así que el backend nuevo es un espejo de código probado, no un diseño nuevo.

**Se descartó el link mágico / QR de alta como método principal** porque el link es una credencial viva: reenviado por WhatsApp, da de alta a cualquiera. El doc 03 lo deja como *conveniencia opcional* (un QR que contiene el mismo código de 8 dígitos, un solo uso, TTL 10 min) — mismo nivel de riesgo que decir el código en voz alta, no más.

### D3 — Confirmación explícita de visita (divergencia deliberada)

La app nativa **acumula la visita automáticamente** al identificar al cliente (`mostrador.tsx:148`, el escaneo deliberado ya es la confirmación). El Mostrador Web va a pedir un **tap explícito en "Confirmar visita"**.

**Esto crea una inconsistencia de producto:** el mismo negocio se comporta distinto según el dispositivo. Se acepta para v1 porque en web un escaneo accidental es más fácil (la cámara queda corriendo en un loop). **Recomendación para v2:** volverlo un ajuste del merchant (`mostradorAutoAccumulate: boolean`, junto a `mostradorSessionSeconds` que ya existe) en vez de dejarlo hard-codeado por plataforma. Si no se hace, en 3 meses nadie va a recordar por qué son distintos.

### D4 — Escaneo en dos niveles, obligatorio

`BarcodeDetector` nativo cuando existe; **fallback wasm/JS vendorizado cuando no**.

**Este es el punto donde el proyecto se rompe si se implementa mal.** `BarcodeDetector` está en Chrome Android; Safari en iOS históricamente **no lo soporta** (y ese estado puede haber cambiado — el diseño de dos niveles hace que dé igual: si Safari ya lo trae, se usa; si no, cae al fallback). Una implementación que asuma `BarcodeDetector` deja a **todos los iPhone sin escanear**, que en México en mostradores de heladería/cafetería es la mitad del parque o más.

### D5 — Online-only, sin service worker en v1

En web no hay SQLite y `loyaltyOutbox` hace no-op. El Mostrador Web **no acumula offline**. Es una degradación real frente a la app nativa y hay que decirlo al vender.

Tampoco lleva service worker en v1: un SW mal configurado sirve una versión vieja de la página para siempre y es el bug más caro de diagnosticar en un cliente. Un HTML de 60 KB carga rápido sin él. Se puede añadir después con estrategia *network-first* y versión en el nombre del cache.

---

## 4. Riesgos, ordenados por lo que realmente puede tumbar esto

1. **iOS sin `BarcodeDetector`.** Mitigación: D4, no negociable. Criterio de aceptación: probado en un iPhone real antes de dar por terminada la tarea.
2. **Cámara ultra-wide en Android.** `facingMode: 'environment'` a veces selecciona la lente ultra-gran-angular, que no enfoca a 10 cm — la cámara "funciona" pero no lee nunca el QR y parece un bug del escáner. Mitigación: botón "Cambiar cámara" con `enumerateDevices()`.
3. **PWA en iOS + `getUserMedia`.** En modo *standalone* (agregado a inicio) iOS tuvo problemas históricos con la cámara, resueltos hace varias versiones. Mitigación: probar en un iPhone real en modo standalone antes de prometer "se instala como app". Si falla, se documenta "ábrelo desde Safari" y ya.
4. **`deviceToken` en `localStorage`.** Es más frágil que `expo-secure-store`. HTTPS **no** resuelve esto. Lo que realmente lo mitiga: el token está acotado a `/pos/*` (no mueve dinero ni lee datos de admin), es revocable individualmente desde el dashboard, y `lastUsedAt` deja rastro. Aceptable para el poder que tiene.
5. **`DAILY_LIMIT_REACHED` llega tarde.** Con confirmación explícita, el cajero identifica al cliente, pulsa "Confirmar visita" y **ahí** recibe un 429 (`transaction.service.ts:74`). Mitigación mínima: manejar el 429 con un mensaje claro ("Este cliente ya registró su visita de hoy"). Mitigación buena: exponer `dailyLimitReached` en la respuesta del `lookup` — ver doc 01, §4.
6. **Duplicación de UI (D1).** No tumba nada hoy; se cobra en 6 meses.

---

## 5. División de trabajo

Criterio vigente del proyecto: **toca BD = Bernardo**.

| Doc | Repo | Responsable | Toca BD |
|---|---|---|---|
| `01_BERNARDO_BACKEND.md` | `Loyalty-app/backend` | Bernardo | Sí (1 modelo nuevo) |
| `02_CODEX_MOSTRADOR_WEB.md` | `Loyalty-Web` | Roberto / Codex | No |
| `03_DASHBOARD_DISPOSITIVOS.md` | `Loyalty-dashboard` | Roberto / Codex | No |

**Orden:** 01 desbloquea 02 y 03. El frontend puede empezar contra un stub, pero no se puede probar de punta a punta hasta que `/mostrador/pair` exista.

---

## 6. Lo que NO hay que hacer

- **No** meter lógica de negocio en `mostrador.html`. Cálculo de visitas, límites diarios, premios: todo vive en `/pos/*`. La página es una carcasa.
- **No** tocar `packages/loyalty-backend` de `Desktop\Copo` — es el módulo legacy pre-pivot. El motor real es `Loyalty-app/backend`.
- **No** implementar canje de recompensas ni puntos (fuera de v1).
- **No** guardar el `verificationGrant` ni datos del cliente en `localStorage`. Solo en memoria, y se descartan al cerrar la sesión del cliente.
- **No** pedir permiso de cámara al cargar la página. Solo tras un tap del usuario (iOS lo exige y además es de buena educación).
