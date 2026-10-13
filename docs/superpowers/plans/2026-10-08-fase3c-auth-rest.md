# Fase 3c — Cuentas reales y REST: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El server acepta tokens de Supabase Auth (invitados), identifica jugadores por `profiles.id`, expone `/v1/me` (GET/PATCH/DELETE) con Swagger, logs pino con `requestId`, `helmet` e identidad de desarrollo opt-in.

**Architecture:** Un verificador JWT local (`jose` + JWKS del proyecto) alimenta tanto el `IdentityPort` del socket como un guard REST. Toda la capa de mesas, store y cuentas pasa a trabajar con `profiles.id`; la identidad de desarrollo solo traduce `dev:<nombre>` a un `profiles.id`. Borrar cuenta = levantar de la mesa + anonimizar en transacción + borrar en Supabase Auth con reintento.

**Tech Stack:** `jose` 6.2.12 (ESM; el server CommonJS lo carga con `require(esm)` de Node 24, igual que Nest 12) · `@nestjs/swagger` 12.0.2 · `nestjs-pino` 5.3.1 + `pino` 10.4.0 + `pino-http` 11.0.0 · `helmet` 8.3.0 · `@supabase/supabase-js` 2.117.3 (solo en el server para `auth.admin.deleteUser`, y en el cliente de consola para el invitado) · Prisma 7.10.0 (existente).

**Spec:** `docs/superpowers/specs/2026-10-08-fase3c-auth-rest-design.md`

## Global Constraints

- Errores REST: `{ "error": { "code", "message", "requestId" } }`; socket: `{ type: 'error', code, message }`.
- Nunca loguear ni devolver: tokens, `authorization`, secret key, URLs de conexión, contraseñas, cartas ni estado de mesa. `SUPABASE_SECRET_KEY` solo en `apps/server/.env`.
- Invariantes 1 y 7 de CLAUDE.md siguen vigentes (borrar cuenta pasa por el ledger; `auditChips` debe cuadrar).
- `iss = ${SUPABASE_URL}/auth/v1`, `aud = authenticated`, `sub` = id de usuario; `is_anonymous` = invitado.
- `dev:<nombre>` solo con `DEV_IDENTITY=true` y nunca con `NODE_ENV=production` (en producción `DEV_IDENTITY=true` hace fallar el arranque).
- Apodo: 3–20 caracteres `[A-Za-z0-9_]`, único entre perfiles no borrados; automático `Jugador<4 dígitos>`.
- Los tests no usan red: JWKS local generado en el test.
- Windows: comandos de PowerShell para el usuario; sin heredocs.

## Review Focus

1. **Token de una cuenta recién borrada** que llega por socket o REST antes de vencer → `UNAUTHORIZED`. Test en Task 5.
2. **Dos usuarios nuevos que sacan el mismo apodo automático a la vez** → ambos quedan con apodos distintos (reintento ante conflicto único). Test en Task 2.
3. **Borrar cuenta estando sentado en plena mano** → espera la persistencia (≤ 30 s) o `ACCOUNT_BUSY`; nunca anonimiza con fichas en la mesa. Test en Task 5.
4. **Header `x-request-id` malicioso** (larguísimo o con saltos de línea) → se ignora y se genera uno nuevo. Test en Task 4.
5. **JWKS inalcanzable** (Supabase caído) → handshake/REST rechazan con `UNAUTHORIZED` sin colgar ni filtrar detalles; se recupera solo cuando vuelve. Test en Task 3.

---

## Mapa de archivos

```
apps/server/prisma/migrations/<ts>_profiles_auth/migration.sql
packages/shared/src/me.ts                      schemas Zod de /v1/me, AVATAR_IDS, NICKNAME_REGEX
packages/shared/src/table-protocol.ts          TableUpdate.names; códigos nuevos
apps/server/src/auth/
  token-verifier.ts                            SupabaseTokenVerifier
  supabase-auth.guard.ts                       guard REST
  current-user.decorator.ts
  supabase-admin.ts                            AuthAdminPort + implementación supabase-js
apps/server/src/realtime/identity.ts           IdentityPort → SupabaseIdentity + DevIdentity (opt-in)
apps/server/src/accounts/account.service.ts    por profiles.id; apodos; delete
apps/server/src/me/me.controller.ts, me.module.ts
apps/server/src/observability/                 pino, requestId
apps/server/src/dev-client/play.ts             --guest
```

---

### Task 1: Migración y contratos compartidos

**Files:** migración nueva; `schema.prisma`; `packages/shared/src/me.ts`, `index.ts`, `table-protocol.ts`; tests en `packages/shared/src/me.test.ts` y `apps/server/src/db/schema.int-spec.ts`.

**Interfaces (Produces):**
- BD: `profiles.deleted_at timestamptz NULL`, `profiles.avatar_id text NULL`, `CHECK (nickname ~ '^[A-Za-z0-9_]{3,20}$')` cuando no es NULL, índice único parcial `profiles(nickname) WHERE deleted_at IS NULL AND nickname IS NOT NULL`; enum `LedgerReason` + `account_deleted`. `auditChips` cuenta `account_deleted` como salida registrada.
- shared: `NICKNAME_REGEX`, `AVATAR_IDS = ['a01'..'a12'] as const`, `meResponseSchema` `{ id: uuid, nickname: string, avatarId: AvatarId | null, isGuest: boolean, balance: int, seatedAt: { tableId, seat } | null }`, `patchMeRequestSchema` `{ nickname?, avatarId? }.strict()` (al menos uno), `TableUpdate.names: Record<string, string>`; códigos de error REST/socket nuevos: `NICKNAME_TAKEN`, `ACCOUNT_BUSY`, `NOT_CONFIGURED`.

- [ ] Tests que fallan (schema int: CHECK de apodo, índice único parcial permite repetir si uno está borrado, enum nuevo; shared: schemas aceptan/rechazan) → FAIL → implementar → PASS (`pnpm build:packages`, `pnpm --filter @naipes/shared test`, `pnpm --filter @naipes/server test:int -- schema`) → commit `feat: add account deletion and nickname constraints to the schema`.

---

### Task 2: Jugadores por `profiles.id` y apodos automáticos

**Files:** `account.service.ts`, `account-port.ts`, `prisma-table-store.ts`, `in-memory-table-store.ts`, `realtime/identity.ts`, `table.gateway.ts`, `recovery.service.ts` (si usa handles), tests afectados.

**Interfaces:**
- `Identity = { userId: string /* profiles.id */; isGuest: boolean }`.
- `AccountPort`: `ensureAccount(input: { userId: string; isGuest: boolean } | { devHandle: string }): Promise<string /* profiles.id */>`; `applyDailyRefill(userId: string, now: Date): Promise<number>`.
- `DevIdentity` (solo si `DEV_IDENTITY=true` y no producción): `dev:<nombre>` → `ensureAccount({ devHandle })` → `userId` = `profiles.id`; apodo = `<nombre>` si está libre, si no el automático.
- Cuenta de Supabase nueva: `profiles.id = sub`, `nickname = Jugador<4 dígitos>` con reintento (hasta 20) ante conflicto único.
- `PrismaTableStore` resuelve humanos por `profiles.id` (no más `dev_handle`); bots igual.
- El runtime/director no cambian de forma: el `playerId` humano es un uuid.

- [ ] Tests que fallan (account int: cuenta por id; dos cuentas concurrentes no chocan de apodo — Review Focus 2; dev handle mapea a profile id; store por id) → FAIL → implementar → `pnpm --filter @naipes/server test` PASS → commit `refactor(server): identify players by profile id`.

---

### Task 3: Verificador de tokens de Supabase e identidad del socket

**Files:** `apps/server/src/auth/token-verifier.ts`, `realtime/identity.ts`, `config/env.ts` (`SUPABASE_URL`, `DEV_IDENTITY`), `.env.example`, `tables.module.ts`/módulo de auth, tests `token-verifier.spec.ts`, `identity.spec.ts`, ajustes e2e (los e2e existentes usan `DEV_IDENTITY=true`).

**Interfaces:**
- `class SupabaseTokenVerifier { constructor(opts: { supabaseUrl: string; jwks?: JWTVerifyGetKey /* inyectable en tests */ }); verify(token: string): Promise<{ sub: string; isAnonymous: boolean } | null> }` — `null` ante cualquier fallo (incluido JWKS inalcanzable, con timeout ≤ 5 s); nunca lanza ni loguea el token.
- `SupabaseIdentity implements IdentityPort`: verifica, rechaza perfiles con `deleted_at` (la consulta la hace el AccountPort: `isDeleted(userId)`), llama `ensureAccount`.
- Composición: con `DEV_IDENTITY=true` (no producción) se acepta `dev:` además de JWT.
- Env: `SUPABASE_URL` obligatoria salvo `DEV_IDENTITY=true` fuera de producción; `DEV_IDENTITY=true` + producción → arranque falla.

- [ ] Tests que fallan (JWKS local con `generateKeyPair` + `createLocalJWKSet`: válido, vencido, otro iss, otra aud, mala firma, anónimo; JWKS que rechaza/timeout → null — Review Focus 5; `dev:` rechazado sin `DEV_IDENTITY`; env combinaciones) → FAIL → implementar → `pnpm --filter @naipes/server test` PASS → commit `feat(server): accept Supabase access tokens on the table socket`.

---

### Task 4: REST `/v1/me` (GET/PATCH), Swagger, pino, helmet, `names`

**Files:** `apps/server/src/me/*`, `auth/supabase-auth.guard.ts`, `auth/current-user.decorator.ts`, `observability/*`, `setup-app.ts`, `main.ts`, `common/api-exception.filter.ts`, `table-runtime.ts`/`hand-recorder`-adyacente para `names` (o el gateway, donde se arma el `TableUpdate`), `docs/protocol.md` (names), tests.

**Interfaces:**
- `GET /v1/me` → `meResponseSchema`; `PATCH /v1/me` → igual; apodo repetido → 409 `NICKNAME_TAKEN`; body inválido → 400 `INVALID_REQUEST`; sin token/inválido → 401 `UNAUTHORIZED`.
- `seatedAt` desde el director (`tableOf(userId)` + `seatOf`).
- `names` en cada `table:update`: apodo de cada humano sentado (cacheado por mesa; se actualiza si cambia el apodo) y nombre de bot sin prefijo.
- `requestId`: `x-request-id` si cumple `^[A-Za-z0-9-]{1,64}$`, si no uuid nuevo (Review Focus 4); en header de respuesta y en el error.
- pino con `redact` de `req.headers.authorization`, `*.token`, `*.password`, `*.secret*`.
- `helmet()` en `setupApp`; Swagger en `/docs` desde los schemas (Zod → OpenAPI vía `@nestjs/swagger` decorators o `zod`→JSON schema).

- [ ] Tests que fallan (e2e REST con token firmado por JWKS local inyectado: GET/PATCH, 409, 401, 400, `/docs` 200, `x-request-id` válido se respeta e inválido se reemplaza; `names` llega en `table:update`; log capturado no contiene el token) → FAIL → implementar → `pnpm --filter @naipes/server test` PASS → commit `feat(server): add /v1/me, Swagger, structured logs and helmet`.

---

### Task 5: `DELETE /v1/me` (anonimizar) y limpieza en Auth

**Files:** `auth/supabase-admin.ts`, `accounts/account.service.ts` (`deleteAccount`), `me.controller.ts`, `table-director.ts` (`evict(userId, timeoutMs)`), `table.gateway.ts` (desconectar sockets del usuario), `recovery.service.ts` o servicio de arranque (reintento de borrado en Auth), env `SUPABASE_SECRET_KEY`, tests.

**Interfaces:**
- `interface AuthAdminPort { deleteUser(userId: string): Promise<void> }`; implementación con `createClient(SUPABASE_URL, SUPABASE_SECRET_KEY).auth.admin.deleteUser`. Sin secret key fuera de producción → `DELETE /v1/me` 503 `NOT_CONFIGURED`.
- `TableDirector.evict(userId: string, timeoutMs = 30000): Promise<'done' | 'busy'>`: levanta al usuario (cash-out normal; si está en mano espera a que se guarde) o `busy` al vencer.
- `AccountService.deleteAccount(userId)`: transacción — wallet a 0 con ledger `account_deleted` (si saldo > 0), anonimiza perfil (`nickname`, `dev_handle`, `avatar_id` NULL, `deleted_at = now()`).
- Orden en el endpoint: `evict` (`busy` → 409 `ACCOUNT_BUSY`) → `deleteAccount` → desconectar sockets del usuario (`UNAUTHORIZED`) → `authAdmin.deleteUser` (si falla: log y queda para el arranque) → 204.
- Al arrancar: para perfiles con `deleted_at` cuyo usuario aún existe en Auth, reintentar `deleteUser` (best-effort, no bloquea el arranque).

- [ ] Tests que fallan (int: borrar con saldo → 0 y `account_deleted`, perfil anonimizado, `auditChips` cuadra; borrar sentado en mano → espera/`ACCOUNT_BUSY` — Review Focus 3; e2e: después de borrar, el mismo token da 401 en REST y `UNAUTHORIZED` en socket — Review Focus 1; `AuthAdminPort` simulado que falla una vez → reintento al arrancar) → FAIL → implementar → `pnpm --filter @naipes/server test` PASS → commit `feat(server): delete accounts by anonymizing them`.

---

### Task 6: Cliente de consola `--guest`, documentación y cierre

**Files:** `apps/server/src/dev-client/play.ts` (+ helper puro testeable `guest-session.ts`), `docs/protocol.md`, `CLAUDE.md`, `apps/server/.env.example`.

- `pnpm play -- --guest [--url …]`: lee `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` de `apps/server/.env`, crea un usuario anónimo (`supabase.auth.signInAnonymously()`), se conecta con su `access_token`; muestra el apodo del perfil. `--name` sigue con `DEV_IDENTITY=true`. Renderiza `names` en vez de ids.
- Docs: protocolo (auth por JWT, `names`, REST `/v1/me`, códigos nuevos, borrar cuenta), CLAUDE.md (comandos, variables, estado "En curso: 3c … pendiente activar anónimos y prueba manual", deuda: retirar identidad dev fail-open; agregar las que surjan).
- [ ] Tests (helper puro: arma opciones/valida env; render usa `names`) → implementar → `pnpm lint`, `pnpm typecheck`, `pnpm test` PASS → commit `feat(server): guest sign-in in the console client and phase 3c docs`.

---

### Paso final (controlador + usuario)

1. Usuario: Supabase → Authentication → activar "Allow anonymous sign-ins"; pegar en `apps/server/.env`: `SUPABASE_URL=https://bkrohlyktsobhqovawhi.supabase.co`, `SUPABASE_PUBLISHABLE_KEY=…` (pública) y `SUPABASE_SECRET_KEY=…` (secreta; Settings → API Keys).
2. Controlador: `pnpm db:migrate:deploy`.
3. Prueba manual: server + `pnpm play -- --guest` → jugar; `GET /v1/me` y `PATCH` (Swagger en `/docs`); `DELETE /v1/me` → el usuario desaparece de Auth y el wallet queda en 0 con `account_deleted`.
