# Copo Loyalty — Web pública

Páginas estáticas que usan los clientes finales de cualquier negocio con Copo Loyalty (sin necesidad de instalar nada):

- `loyalty-join.html` — registro: escanea el QR del negocio, llena nombre/teléfono/PIN, agrega la tarjeta a su Wallet (Google/Apple).
- `loyalty-pass.html` — tarjeta web de respaldo si el cliente no usa Wallet: saldo, QR rotativo (OTP), reset de PIN.
- `loyalty-reset-pin.html` — formulario de restablecimiento de PIN (link recibido por email).

Todas apuntan a `loyalty-api` (servicio standalone) vía `window.COPO_API_BASE`, con default `https://api-loyalty.copopos.com`. Para apuntar a otro ambiente, define esa variable global antes de cargar el script, o sirve estos archivos con un pequeño script que la inyecte según el dominio.

## Deploy

Son 3 archivos HTML autocontenidos (sin build step, sin dependencias). Sirven con cualquier hosting estático (Vercel, Netlify, Railway static, S3+CloudFront, etc.) o desde el propio `loyalty-api` como archivos estáticos.
