# Fase 3d — Despliegue en Render · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desplegar `apps/server` en Render (plan gratis) desde `main`, con drenado de mesas al apagar.

**Architecture:** `TableDirector.shutdown()` pasa de "cerrar en el acto" a "dejar de repartir → esperar a que cada mesa termine y guarde su mano (tope `shutdownDrainMs`) → cerrar". Un Blueprint `render.yaml` en la raíz describe el servicio (runtime Node nativo, sin Docker). ADR 0009 documenta Render free.

**Tech Stack:** NestJS 12, Jest (scheduler falso de `src/tables/testing`), pnpm 10, Node 24, Render Blueprints.

**Spec:** `docs/superpowers/specs/2026-10-16-fase3d-deploy-design.md`

## Global Constraints

- Presupuesto $0: `plan: free`. Sin Docker.
- Región `ohio`; si el plan free no la ofrece, `virginia`.
- Tope del drenado: `SHUTDOWN_DRAIN_MS`, por defecto `60000`. `maxShutdownDelaySeconds: 90`.
- Secretos (`DATABASE_URL`, `DIRECT_URL`, `SUPABASE_SECRET_KEY`) con `sync: false`; nunca en el repo.
- Código y commits en inglés (Conventional Commits); docs en español.
- No se tocan las reglas del juego (`packages/engine`).

## Review Focus

- Apagado con una mesa **degradada** (mano sin guardar porque la BD falla): el drenado no debe colgarse esperando un guardado que no llega; el tope la corta → test en Task 1.
- Apagado **dos veces** (`beforeApplicationShutdown` + `onApplicationShutdown` llaman a `shutdown()`): la segunda llamada no espera otro tope ni duplica cash-outs → test en Task 1.
- Mesa que **cierra por vacía** durante el drenado: no debe quedar esperándose para siempre → test en Task 1.
- Build en Render con `NODE_ENV=production`: pnpm omitiría `devDependencies` (Nest CLI, Prisma CLI, TypeScript) → `--prod=false` y verificación local en Task 2.
- `quickSeat` durante el drenado responde `TABLE_CLOSED` → test en Task 1.

---

### Task 1: Drenado de mesas al apagar

**Files:**
- Modify: `apps/server/src/config/env.ts` (nuevo `SHUTDOWN_DRAIN_MS: int(60000).pipe(z.number().min(0))`)
- Modify: `apps/server/src/config/env.spec.ts` (si fija la lista de campos/defaults)
- Modify: `apps/server/src/tables/table-settings.ts` (`shutdownDrainMs: number` en `TableSettings`, mapeado desde `env.SHUTDOWN_DRAIN_MS`)
- Modify: `apps/server/src/tables/table-director.ts` (`shutdown()`, hooks `afterHand`/`closed`)
- Modify: `apps/server/.env.example` (`SHUTDOWN_DRAIN_MS=60000` con comentario)
- Test: `apps/server/src/tables/table-director.spec.ts` (fixture `SETTINGS` con `shutdownDrainMs`)

**Interfaces:**
- Produces: `TableSettings.shutdownDrainMs: number`; `TableDirector.shutdown(): Promise<void>` (misma firma; ahora drena). Idempotente: llamadas concurrentes o repetidas comparten la misma promesa.

- [ ] **Step 1: Tests que fallan** en `table-director.spec.ts` (`describe('shutdown drain')`, `SETTINGS.shutdownDrainMs = 60_000`):
  - `'lets the hand in progress finish before closing'`: dos humanos sentados, mano en curso; `const done = director.shutdown()`; se juega la mano hasta liquidarse (fold del jugador en turno vía `table.act`); `await done` → `events` contiene `handSettled` y **no** `handVoided`; `closed` = `[{ tableId: 't1', reason: 'shutdown' }]`; suma de wallets = `2 * TEST_WALLET_INITIAL`; `house.houseOutstanding()` = 0.
  - `'starts no new hand while draining'`: tras la liquidación anterior, avanzar `betweenHandsMs` antes de que resuelva el cierre → ningún `handStarted` nuevo.
  - `'voids the hand when the drain times out'`: mano en curso, nadie actúa; `director.shutdown()`; `scheduler.advance(60_000)` → `handVoided`, wallets = `TEST_WALLET_INITIAL` cada uno (comportamiento del test actual `'shutdown voids hands and credits every human'`, que se adapta avanzando el tope).
  - `'closes at once when no hand is in progress'`: sin mano en curso → `await director.shutdown()` resuelve sin avanzar el scheduler.
  - `'does not hang on a degraded table'`: store que falla el guardado (patrón ya usado en los tests de persistencia) → mano liquidada pero sin guardar; `shutdown()` + `advance(60_000)` resuelve y cierra.
  - `'is idempotent'`: `Promise.all([director.shutdown(), director.shutdown()])` + `advance(60_000)` → un solo `closed` por mesa; cash-outs no duplicados.
  - `'rejects quick seat while draining'`: durante el drenado `quickSeat('carol')` → `{ ok: false, error: { code: 'TABLE_CLOSED' } }`.
  - `'stops waiting for a table that closes as empty'`: mesa cuyo último humano se va durante el drenado → `shutdown()` resuelve sin esperar el tope completo.

- [ ] **Step 2:** `pnpm --filter @naipes/server test:unit -- table-director` → FAIL (la mano se anula en el acto; `shutdownDrainMs` no existe).

- [ ] **Step 3: Implementar.** En `TableDirector`:
  - `shuttingDown = true`; `stopDealing()` en cada mesa.
  - Esperar a que cada mesa esté "quieta": `!isHandInProgress() && !degraded`, o cerrada. Se observa con los hooks que el director ya pasa a cada runtime (`afterHand`, `closed`): un `Set` de resolvers que se revisa en cada hook. No hacer polling.
  - `Promise.race` entre "todas quietas" y un `deps.scheduler.schedule(settings.shutdownDrainMs, …)`; cancelar el timer si gana la primera.
  - Luego el cierre actual (`table.close('shutdown')` en todas).
  - Guardar la promesa en un campo (`private shutdownPromise: Promise<void> | null`) para la idempotencia.
  - Log `info` al empezar (`Draining N table(s), up to Xs`) y `warn` si vence el tope (`Drain timed out; voiding N hand(s)`).
  - Actualizar el doc-comment de `close()` en `table-runtime.ts` solo si deja de ser exacto (no debería).

- [ ] **Step 4:** `pnpm --filter @naipes/server test` (unit + int + e2e) → PASS. Revisar que el e2e de apagado (si existe) no tarde 60 s: en e2e usar `SHUTDOWN_DRAIN_MS` bajo vía env del test.

- [ ] **Step 5:** `pnpm lint && pnpm typecheck` → sin errores. Commit: `feat(server): drain tables on shutdown before closing them`.

### Task 1b: Candado de instancia y recuperación en segundo plano (spec §2b)

**Files:**
- Create: `apps/server/src/recovery/instance-lock.ts` — `class InstanceLock { constructor(opts: { url: string; logger: LoggerLike; retryMs?: number /* 2000 */ }); acquire(signal?: AbortSignal): Promise<void>; release(): Promise<void> }`. Conexión `pg.Client` propia; `SELECT pg_try_advisory_lock(<clave fija>)` hasta que dé `true`.
- Modify: `apps/server/src/recovery/recovery.service.ts` — `recover(opts?: { exclude?: () => ReadonlySet<string> })`: salta asientos cuyo `table_id` esté en `exclude()` (evaluado por asiento) y el `UPDATE tables … closed` excluye esos ids.
- Modify: `apps/server/src/tables/tables.module.ts` — quitar `RECOVERED` como dependencia del director; un provider/servicio de arranque que, sin bloquear el boot, hace `lock.acquire()` → `recover({ exclude: () => new Set(director.tables().map(t => t.id)) })`; en el apagado, después de cerrar las mesas, `lock.release()` (y abortar `acquire` pendiente).
- Modify: `apps/server/src/config/env.ts` — `DIRECT_URL` obligatoria con `NODE_ENV=production`.
- Test: `apps/server/src/recovery/instance-lock.int-spec.ts`, `recovery.service.int-spec.ts`, `config/env.spec.ts`.

- [ ] Tests (RED): `'a second lock waits until the first is released'` (dos `InstanceLock` sobre el Postgres embebido: el segundo `acquire` no resuelve hasta `release` del primero); `'the lock is released when its connection dies'`; `'acquire can be aborted'`; `'recover skips seats of excluded tables and leaves them open'`; `'DIRECT_URL is required in production'`.
- [ ] Implementar; `pnpm --filter @naipes/server test` en verde (e2e incluidos: el arranque ya no espera la recuperación, revisar e2e de persistencia que reinician la app).
- [ ] Commit: `feat(server): recover seats only after the previous instance released its lock`.

### Task 2: Blueprint de Render y build de producción

**Files:**
- Create: `render.yaml`
- Modify: `package.json` raíz solo si hace falta un script `start:server` (`node apps/server/dist/src/main.js`).

- [ ] **Step 1: Verificar datos vigentes de Render** en `render.com/docs/yaml-spec` y `render.com/docs/free`: nombre exacto de `autoDeployTrigger: checksPass`, regiones disponibles en `plan: free`, que `maxShutdownDelaySeconds` aplica en free, y cómo fijar la versión de Node (`NODE_VERSION` o `.node-version`). Si algo difiere de la spec, anotarlo en el resumen al usuario y ajustar.

- [ ] **Step 2: Escribir `render.yaml`** con un `web` service `naipes-server`, según la tabla de la spec §1, con `buildCommand`:
  `corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm build && pnpm db:migrate:deploy`
  y `startCommand`: `node apps/server/dist/src/main.js`. `envVars`: `NODE_ENV=production`, `NODE_VERSION` = contenido de `.nvmrc`, `SUPABASE_URL=https://kptoaakzlikfcxerckxe.supabase.co`, `LOG_LEVEL=info`, `DEV_IDENTITY=false`, `SHUTDOWN_DRAIN_MS=60000`; y `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_SECRET_KEY` con `sync: false`.

- [ ] **Step 3: Simular el build en limpio** (en una copia, sin tocar el `node_modules` del usuario):
  `git worktree add ../naipes-buildcheck HEAD` → en ella, con `NODE_ENV=production`: `corepack enable; pnpm install --frozen-lockfile --prod=false; pnpm build` → termina sin errores y existe `apps/server/dist/src/main.js`. Borrar el worktree al terminar (`git worktree remove`). (`db:migrate:deploy` no se corre aquí: ya está aplicada.)

- [ ] **Step 4: Arranque en modo producción local** contra Supabase: `NODE_ENV=production PORT=3111 node apps/server/dist/src/main.js` con el `.env` del usuario → `GET /health` 200; luego `SIGTERM` (Ctrl+C) → log de drenado y salida limpia. Si `NODE_ENV=production` rechaza algo del `.env` local, anotar y corregir solo si es un bug.

- [ ] **Step 5:** Commit: `chore: add Render blueprint for the server`.

### Task 3: ADR 0009 y documentación

**Files:**
- Create: `docs/decisions/0009-render-free-hosting.md` (formato de los ADR existentes: Contexto / Opciones / Decisión / Consecuencias / Disparador; contenido de la spec "Decisión de proveedor").
- Modify: `docs/decisions/0006-*.md`: línea "Matizado por 0009" bajo Estado.
- Modify: `CLAUDE.md`: en "Decisiones tomadas" agregar 0009; en "Hosting del servidor" Render; en "Comandos" una entrada "Deploy" (push a `main` con CI verde → Render; secretos en el panel; logs en el panel); en "Estado actual" la 3d en curso/hecha; en "Restricciones" presupuesto `$0 (planes gratuitos)`.

- [ ] **Step 1:** Escribir el ADR y los cambios de docs.
- [ ] **Step 2:** `pnpm lint` (por si prettier revisa markdown) → OK. Commit: `docs: add ADR 0009 (Render free tier) and deploy docs`.

### Task 4 (usuario, guiado por Claude): crear el servicio y prueba manual

No es código. Claude guía paso a paso; el usuario hace cada acción con su cuenta.

- [ ] Crear cuenta en Render (con GitHub) y **New → Blueprint** apuntando a `Ezy01v1/Ezybalatro`, rama `main` (requiere que el merge de esta rama ya esté en `main`).
- [ ] Pegar `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_SECRET_KEY` (rotadas) cuando Render las pida.
- [ ] Primer deploy verde; anotar la URL en `CLAUDE.md` (commit aparte).
- [ ] Prueba manual de la spec §4: `/health`, `pnpm play -- --guest --url https://<servicio>.onrender.com` desde otra red, push con mesa abierta (drenado), cold start tras 15 min.
