# Fase 3c — Cuentas reales y REST: diseño

Fecha: 2026-10-08 · Estado: aprobado en conversación, pendiente de revisión escrita
Rama: `feat/phase-3c-auth-rest` · Antecede: Fase 3b (`2026-10-08-fase3b-persistencia-fichas-design.md`)

## 1. Objetivo y alcance

El server acepta cuentas reales de Supabase Auth (invitados anónimos hoy; vinculadas a Google/Apple en la Fase 4, con el mismo id), expone REST `/v1/me` con Swagger, y queda listo para exponerse: logs estructurados con `requestId`, `helmet`, identidad de desarrollo opt-in.

**Éxito:** un invitado real creado en Supabase se conecta con su token, recibe 10.000 fichas, juega, consulta y cambia su perfil por REST y borra su cuenta; nada de esto funciona con un token inválido, vencido, de otro proyecto o de una cuenta borrada.

**Decisiones del usuario (2026-10-08):**
- Alcance solo server; botones y configuración de Google/Apple van con la UI en la Fase 4.
- Verificación local del JWT con las claves públicas (JWKS) del proyecto.
- Borrar cuenta = anonimizar (no borrar historial).

**Fuera de alcance:** UI, OAuth de Google/Apple, endpoints de historial, mesa rápida por REST (sigue por socket), deploy (3d).

## 2. Identidad

- Handshake del socket: `auth: { token: "<JWT de Supabase>" }`. Verificación con `jose` (`createRemoteJWKSet` sobre `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, en caché): firma, `exp`, `iss = ${SUPABASE_URL}/auth/v1`, `aud = authenticated`. `sub` = id del usuario; `is_anonymous` = invitado.
- `profiles.id = auth.users.id` para estas cuentas. Al primer contacto (socket o REST) se crea la cuenta (10.000 iniciales, ledger `initial`) con apodo automático `Jugador<4 dígitos>` (único; reintenta si choca).
- El `playerId` del runtime de mesa pasa a ser el `profiles.id` (uuid) para humanos; bots siguen `bot:<Nombre>`. El store y el `AccountService` trabajan por `profiles.id` (la identidad de desarrollo resuelve `dev:<nombre>` → `profiles.id` por `dev_handle` al autenticar).
- **Identidad de desarrollo:** `dev:<nombre>` solo con `DEV_IDENTITY=true`; con `NODE_ENV=production` se rechaza siempre (y `DEV_IDENTITY=true` en producción hace fallar el arranque).
- Token de una cuenta con `deleted_at` → `UNAUTHORIZED`.
- **Apodos en la mesa:** `TableUpdate` agrega `names: Record<playerId, string>` (apodo del perfil; para bots, el nombre sin prefijo).

## 3. Datos (migración nueva)

- `profiles.deleted_at timestamptz NULL`.
- `LedgerReason` agrega `account_deleted`.
- Índice único parcial `profiles(nickname) WHERE deleted_at IS NULL`; `nickname` 3–20 caracteres `[A-Za-z0-9_]` (validado en DTO; CHECK en BD).
- `profiles.avatar_id text NULL` (de un set predefinido; en 3c se valida contra una lista de ids en `shared`).

## 4. REST (`/v1`, `Authorization: Bearer <JWT>`)

| Endpoint | Respuesta / efecto |
|---|---|
| `GET /v1/me` | `{ id, nickname, avatarId, isGuest, balance, seatedAt: { tableId, seat } \| null }` |
| `PATCH /v1/me` | `{ nickname?, avatarId? }` → perfil actualizado; apodo repetido → 409 `NICKNAME_TAKEN` |
| `DELETE /v1/me` | 204; ver §5 |

- Guard común `SupabaseAuthGuard` (mismo verificador que el socket). Sin token o token inválido → 401 `UNAUTHORIZED`.
- Errores con el formato `{ error: { code, message, requestId } }`.
- DTOs con schemas Zod de `shared` (también usados por la app en la Fase 4); Swagger generado desde ellos en `/docs`.

## 5. Borrar cuenta (anonimizar)

1. Si está sentado: el director lo levanta (cash-out normal; si está en mano, espera a que la mano se guarde, con un tope de 30 s; si se vence, 409 `ACCOUNT_BUSY` para reintentar).
2. Transacción: wallet a 0 con ledger `account_deleted` (delta = −saldo, si saldo > 0); `profiles`: `nickname = NULL`, `dev_handle = NULL`, `avatar_id = NULL`, `deleted_at = now()`.
3. `auth.admin.deleteUser(id)` con `SUPABASE_SECRET_KEY` (solo server). Si falla, se loguea y se reintenta en el siguiente arranque (tarea de limpieza: perfiles con `deleted_at` cuyo usuario aún existe).
4. Sockets abiertos de ese usuario se desconectan con `UNAUTHORIZED`.

La auditoría global de fichas incluye `account_deleted` como salida de fichas registrada.

## 6. Operación

- **Logs:** `nestjs-pino`; `requestId` desde `x-request-id` o generado (uuid), devuelto en el header y en el error. Redacción obligatoria: `authorization`, `token`, `password`, URLs de conexión. Nunca cartas ni estado de mesa.
- **`helmet`** en HTTP; CORS como hoy.
- **Swagger** en `/docs` (también en producción; no expone secretos).
- **Env nuevas:** `SUPABASE_URL` (obligatoria salvo con `DEV_IDENTITY=true` fuera de producción), `SUPABASE_SECRET_KEY` (obligatoria en producción; sin ella en desarrollo `DELETE /v1/me` responde 503 `NOT_CONFIGURED`), `DEV_IDENTITY` (default `false`).

## 7. Herramientas de prueba

- `pnpm play -- --guest [--url …]`: crea un usuario anónimo con la publishable key (`SUPABASE_PUBLISHABLE_KEY`, env del cliente de consola, no secreta) vía la API de Auth y se conecta con su token. `--name` sigue funcionando con `DEV_IDENTITY=true`.

## 8. Tests

- Verificador JWT con un JWKS local generado en los tests (sin red): válido, vencido, otro `iss`, otra `aud`, mala firma, cuenta borrada, invitado anónimo.
- Integración (Postgres embebido): cuenta creada por id de Supabase con apodo único; `PATCH` con apodo repetido → `NICKNAME_TAKEN`; borrar cuenta sentado → cash-out, saldo 0 con `account_deleted`, perfil anonimizado, `auditChips` cuadra; reintento de borrado en Auth al arrancar (cliente de Auth simulado).
- e2e: REST `GET/PATCH/DELETE /v1/me`, socket con token de Supabase (JWKS local), `/docs` responde, `requestId` en errores, `DEV_IDENTITY=false` rechaza `dev:`.

## 9. Terminado

`pnpm lint`, `pnpm typecheck`, `pnpm test` en verde; migración aplicada en Supabase; el usuario activó "Allow anonymous sign-ins" y pegó la secret key; prueba manual con `pnpm play -- --guest` + `/v1/me` + borrar cuenta; CLAUDE.md y `docs/protocol.md` actualizados (retirar la deuda de identidad de desarrollo fail-open).
