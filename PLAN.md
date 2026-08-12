# Plan vigente

## Objetivo

Servir las páginas públicas de registro, tarjeta y recuperación de PIN sin introducir sinks de HTML dinámico inseguros.

## Criterios de aceptación

- Las tres páginas pasan `npm test`.
- No se usa `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` ni `eval` para contenido dinámico.
- Los datos de clientes y comercios se insertan mediante `textContent` o construcción explícita del DOM.
- El OTP solo se muestra cuando la API devuelve un código válido; los errores fallan cerrados.
- Los tokens de acceso y recuperación se eliminan de la URL visible tras leerlos.
- El workflow de CI ejecuta las regresiones en cada push a `main` y pull request.

## Pendiente externo

- Probar manualmente los tres flujos contra Loyalty API en staging antes de desplegar.
