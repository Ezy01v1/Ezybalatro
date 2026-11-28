# Fase 4c — Perfil y borrar cuenta (app móvil)

Fecha: 2026-11-24 · Rama: `feat/phase-4a-table` (la 4a aún no está en `main`).

## Alcance

- Pantalla `/profile`, abierta con el engranaje del menú: apodo editable, saldo, recarga diaria (texto), aviso de cuenta de invitado, borrar cuenta.
- El servidor ya estaba hecho (`PATCH`/`DELETE /v1/me`, `docs/protocol.md`); esta fase solo toca la app.
- **Fuera de alcance:** login con Google/Apple/email (se descartó el 2026-11-24, ver ADR 0005), selector de avatar (no hay arte; el servidor acepta `a01`–`a12`), historial.

## Decisiones

- Borrar cuenta: confirmación en dos pasos (el botón abre un aviso con "Sí, borrar mi cuenta" / "Cancelar"). El aviso dice que no se puede deshacer, que se levanta de la mesa y que la run del roguelike se queda en el teléfono.
- La run del roguelike es local: **no se borra** con la cuenta.
- Orden de `deleteAccount()` (`src/auth/account.ts`): `DELETE /v1/me` → reset del store de la mesa → `signOut({ scope: 'local' })` (el usuario de Supabase ya no existe) → borrar saldo en caché y caché de TanStack Query → nueva sesión de invitado. Si el servidor rechaza (`ACCOUNT_BUSY`, red, etc.), no se toca nada local.
- Sin red: apodo y borrado deshabilitados con un mensaje. Un `TypeError` de `fetch` se muestra como "sin conexión".

## Prueba manual pendiente (Galaxy A56)

1. Menú → engranaje → se abre el perfil con tu apodo y saldo.
2. Cambiar el apodo a uno válido → "Apodo guardado"; volver al menú y entrar a una mesa: aparece el apodo nuevo.
3. Apodo con símbolos o de 2 letras → mensaje de formato, sin llamada al servidor.
4. Con dos cuentas: apodo repetido → "Ese apodo ya está en uso".
5. Modo avión → apodo y borrar deshabilitados, mensaje "Sin conexión".
6. Estando sentado en una mano → "Borrar mi cuenta" → "Estás en una mano en juego…" (si la mano termina en 30 s, borra y te levanta).
7. Borrar cuenta → vuelve al menú con 10.000 fichas y un apodo `Jugador####` nuevo; en Supabase Auth el usuario anterior ya no existe.
8. Tras borrar, "Continuar run" sigue disponible si tenías una run guardada.
