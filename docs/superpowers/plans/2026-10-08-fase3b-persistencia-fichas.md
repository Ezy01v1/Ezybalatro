# Fase 3b — Persistencia y fichas: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wallets, asientos y manos liquidadas en Postgres con `chip_ledger`, sin crear ni perder fichas ante fallos o reinicios.

**Architecture:** Un puerto `TableStore` (una transacción por operación) reemplaza a `WalletPort` en el runtime y el director de la 3a; `PrismaTableStore` lo implementa sobre Postgres y `InMemoryTableStore` lo emula para los tests unitarios. `AccountService` crea cuentas y aplica la recarga diaria; `RecoveryService` devuelve los stacks al arrancar. Tests de integración y desarrollo local contra un Postgres embebido.

**Tech Stack:** Prisma 7.10.0 (`prisma`, `@prisma/client`, `@prisma/adapter-pg`, todos 7.10.0 exactos; `latest` en npm es una RC 8.x y NO se usa) · `pg` · `embedded-postgres` 18.4.0-beta.17 (única versión publicada; ver Task 1) · NestJS 12 · Jest.

**Spec:** `docs/superpowers/specs/2026-10-08-fase3b-persistencia-fichas-design.md`

## Global Constraints

- Invariante 1: `Σ wallets + Σ stacks` solo cambia por asientos del ledger; ninguna falla crea ni pierde fichas.
- Invariante 7: movimientos wallet ↔ mesa en transacción, con asiento en `chip_ledger` y `UPDATE` condicionado (`... WHERE balance >= X`); nunca leer → calcular → escribir. `CHECK (balance >= 0)` en BD.
- Invariante 4: en la BD solo se guardan cartas mostradas en el showdown.
- Montos `bigint` en BD; enteros (`number`, `Number.isSafeInteger`) en el server. Conversión `BigInt(n)` / `Number(b)` solo en `PrismaTableStore`/`AccountService`.
- `CHIPS_INITIAL=10000`, `CHIPS_DAILY_REFILL_TO=2000`; día de recarga en UTC.
- Ledger `reason` ∈ `initial`, `daily_refill`, `buy_in`, `cash_out`, `recovery_cash_out`, `bot_buy_in`, `bot_cash_out`; `user_id` NULL = la casa.
- RLS activado en todas las tablas, sin políticas. Sin FK a `auth.users`.
- Contraseñas y URLs de conexión nunca en logs, commits ni chat; solo en `apps/server/.env` (git-ignorado).
- Los tests unitarios de la 3a deben seguir pasando (con `InMemoryTableStore`).
- Windows: comandos de PowerShell para el usuario; sin heredocs en scripts.

## Review Focus

1. **Doble conexión del mismo usuario nuevo al mismo tiempo** → una sola cuenta y un solo `initial` (10.000), nunca 20.000. Test en Task 4.
2. **Reloj cerca de medianoche UTC** → la recarga usa el día UTC de `now` inyectado, no la zona del server. Test en Task 4 (23:59:59Z y 00:00:00Z del día siguiente).
3. **El server se reinicia dos veces seguidas** (recovery interrumpida) → no se devuelve un stack dos veces. Test en Task 5.
4. **Un bot se va en la misma mano en que un humano se va** → ambos cash-outs en la misma transacción de `persistHand`, cada uno a su destino (wallet vs casa). Test en Task 3.
5. **`persistHand` falla y en ese lapso un jugador hace `leave`** → el leave queda pendiente hasta que la mano se guarde; nunca hay un `standUp` sobre un stack no persistido. Test en Task 2.

---

## Mapa de archivos

```
apps/server/prisma/schema.prisma
apps/server/prisma/migrations/<timestamp>_init/migration.sql
apps/server/prisma.config.ts
apps/server/src/db/
  prisma.service.ts            PrismaService (Nest provider)
  embedded-database.ts         startEmbeddedDatabase()
  testing/test-database.ts     helpers de integración (reset, auditChips)
apps/server/src/tables/
  table-store.ts               TableStore, HandRecord, SitDownResult
  in-memory-table-store.ts     InMemoryTableStore
  prisma-table-store.ts        PrismaTableStore
  table-runtime.ts             (modificado)
  table-director.ts            (modificado)
  tables.module.ts             (modificado)
apps/server/src/accounts/
  account.service.ts           AccountService
  accounts.module.ts
apps/server/src/recovery/
  recovery.service.ts          RecoveryService
apps/server/test/persistence.e2e-spec.ts
packages/shared/src/table-protocol.ts  (+ table:degraded)
docs/protocol.md, CLAUDE.md, apps/server/.env.example
```

Archivos retirados: `apps/server/src/tables/in-memory-wallet.ts` y su spec (su lógica pasa a `InMemoryTableStore`).

---

### Task 1: Base de datos: Prisma, schema, migración y Postgres embebido

**Files:**
- Create: `apps/server/prisma/schema.prisma`, migración inicial, `apps/server/prisma.config.ts`, `apps/server/src/db/prisma.service.ts`, `apps/server/src/db/embedded-database.ts`, `apps/server/src/db/testing/test-database.ts`
- Modify: `apps/server/package.json` (deps + scripts), raíz `package.json` (scripts `db:migrate:dev`, `db:migrate:deploy`), `.gitignore` (directorio de datos del Postgres embebido)
- Test: `apps/server/src/db/schema.int-spec.ts`

**Interfaces:**
- Produces:
  - `startEmbeddedDatabase(opts?: { port?: number; dataDir?: string; persistent?: boolean }): Promise<{ url: string; stop(): Promise<void> }>`: levanta Postgres embebido en un puerto libre y aplica las migraciones (`prisma migrate deploy` contra esa URL). `persistent: false` (default) usa un directorio temporal y lo borra al parar.
  - `class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy`, construido con `new PrismaPg({ connectionString })` y la URL inyectada (no lee `process.env` directamente).
  - `createTestDatabase(): Promise<{ prisma: PrismaClient; url: string; reset(): Promise<void>; stop(): Promise<void> }>`: un Postgres embebido por suite; `reset()` hace `TRUNCATE ... RESTART IDENTITY CASCADE` de todas las tablas.
  - `auditChips(prisma): Promise<void>`: lanza si falla (a) o (b) de la auditoría del spec §2.
  - Modelos Prisma: `Profile`, `Wallet`, `ChipLedger`, `PokerTable` (`@@map("tables")`), `Seat`, `Hand`, `HandAction`; enum `LedgerReason`; columnas en snake_case con `@map`.
- Jest: los tests de integración son `*.int-spec.ts`, en una config propia `apps/server/jest.int.config.js` (timeout 60 s, `maxWorkers: 1`); script `test:int`; `test` del server corre unit + int + e2e.

- [ ] **Step 1: Verificar el Postgres embebido en Windows (gate)**

Instalar `embedded-postgres@18.4.0-beta.17` y escribir un script descartable que lo arranque, haga `SELECT 1` con `pg` y pare. Si no funciona en Windows tras un intento razonable, **detenerse con BLOCKED** y reportar el error (no buscar alternativas por cuenta propia).

- [ ] **Step 2: Escribir los tests que fallan** (`schema.int-spec.ts`)

```ts
it('applies the migrations and has every table', ...)          // tables, seats, hands, hand_actions, profiles, wallets, chip_ledger
it('rejects a negative wallet balance with a CHECK', ...)       // UPDATE wallets SET balance = -1 → error de restricción
it('rejects a negative seat stack and a seat with both user and bot', ...)
it('rejects a zero ledger delta', ...)
it('enforces unique (user_id, idempotency_key) on the ledger', ...)
it('has row level security enabled on every table', ...)        // pg_class.relrowsecurity = true
it('auditChips passes on an empty database', ...)
```

- [ ] **Step 3: Correr y verificar que fallan**

Run: `pnpm --filter @naipes/server test:int -- schema` · Expected: FAIL.

- [ ] **Step 4: Implementar schema, migración (con CHECKs, índice único parcial y `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` a mano), `prisma.config.ts` (usa `DIRECT_URL` para migraciones), `PrismaService`, `embedded-database.ts`, `test-database.ts` y los scripts**

`pnpm db:migrate:dev` = levanta un Postgres embebido **persistente** en `apps/server/.local-db/` y corre `prisma migrate dev` contra él. `pnpm db:migrate:deploy` = `prisma migrate deploy` con `DIRECT_URL`.

- [ ] **Step 5: Verificar**

Run: `pnpm --filter @naipes/server test:int` · `pnpm --filter @naipes/server lint` · `pnpm --filter @naipes/server typecheck` · Expected: PASS. Agregar en `.github/workflows` nada (el CI ya corre `pnpm test`); confirmar que `pnpm test` del server incluye los int-specs.

- [ ] **Step 6: Commit** — `feat(server): add Prisma schema, migrations and embedded Postgres for tests`

---

### Task 2: Puerto `TableStore` e `InMemoryTableStore` en el runtime y el director

**Files:**
- Create: `apps/server/src/tables/table-store.ts`, `apps/server/src/tables/in-memory-table-store.ts`
- Modify: `table-runtime.ts`, `table-director.ts`, `testing/table-harness.ts`, `tables.module.ts` (provisionalmente con `InMemoryTableStore`), `packages/shared/src/table-protocol.ts` (+ `SOCKET_EVENTS.tableDegraded = 'table:degraded'`, tipo `TableDegraded { tableId: string; degraded: boolean }`), `apps/server/src/realtime/table.gateway.ts` (reenvía el mensaje `degraded`)
- Delete: `in-memory-wallet.ts` y su spec
- Test: `in-memory-table-store.spec.ts`, `table-runtime.persistence.spec.ts`; specs existentes adaptados

**Interfaces:**
- Produces:
  ```ts
  export type SitDownResult = 'ok' | 'insufficient';
  export interface HandRecord {
    tableId: string; handNumber: number; status: 'settled' | 'voided'; buttonSeat: number;
    board: Card[]; awards: PotAward[]; shownHands: ShowdownHand[];
    actions: { seq: number; seat: number; street: 'preflop'|'flop'|'turn'|'river'; type: 'post_blind'|'fold'|'check'|'call'|'bet'|'raise'|'all_in'|'timeout'; amount: number }[];
    stacks: { seat: number; stack: number }[];            // asientos que siguen ocupados tras la mano
    leavers: { playerId: string; seat: number; cashOut: number }[];
  }
  export interface TableStore {
    balance(playerId: string): Promise<number>;
    openTable(tableId: string, config: TableConfig): Promise<void>;
    closeTable(tableId: string): Promise<void>;
    sitDown(a: { tableId: string; seat: number; playerId: string; buyIn: number }): Promise<SitDownResult>;
    standUp(a: { tableId: string; seat: number; playerId: string; cashOut: number }): Promise<void>;
    persistHand(record: HandRecord): Promise<void>;
  }
  export class InMemoryTableStore implements TableStore {
    constructor(opts: { initial: number });
    total(): number;               // Σ wallets
    houseOutstanding(): number;    // fichas puestas por la casa y no devueltas
    failNext(op: keyof TableStore, times?: number): void;   // para tests de fallos
  }
  ```
  `TableRuntimeDeps` y `DirectorDeps`: `wallet`/`house` → `store: TableStore`. `TableMessage` agrega `{ type: 'degraded'; degraded: TableDegraded }`.
- Comportamiento (spec §3.3, §5):
  - `sit`: elige asiento → `store.sitDown` → si `insufficient` ack `INSUFFICIENT_CHIPS` → si `ok` aplica el `sit` del engine; si el engine rechaza, `store.standUp` compensatorio.
  - `leave` entre manos: `store.standUp` primero; si lanza, ack `INTERNAL` y el jugador sigue sentado. Durante una mano: igual que en 3a (queda `leaving`), y su cash-out viaja en `HandRecord.leavers`.
  - Al liquidar o anular: difundir el update; luego `persistHand` dentro de la cola; la próxima mano se programa solo tras confirmarse. `voided` también se persiste (status `voided`, stacks restaurados, sin acciones de apuesta efectivas).
  - Falla de `persistHand`: emitir `degraded: true`, reintentar a 1 s, 2 s, 4 s, 8 s y luego cada 15 s (con el `Scheduler`); al confirmar, `degraded: false` y programar la mano. Los comandos `leave` que lleguen mientras está degradada quedan como `leaving` (no llaman `standUp`) y se resuelven en el siguiente `persistHand` exitoso (Review Focus 5). Nuevos `sit` durante degradación → `INTERNAL`.
  - `close`/shutdown: cada asiento sale con `standUp` (fallos logueados; la recuperación al arrancar los cubre). El director llama `openTable` al crear y `closeTable` al cerrar.
  - Los bots usan el mismo `store` (el store distingue `bot:` y usa la casa).

- [ ] **Step 1: Tests que fallan**

```ts
// in-memory-table-store.spec.ts
it('sitDown debits the wallet or returns insufficient without changes', ...)
it('bots sit with house chips and standUp returns them to the house', ...)
it('persistHand credits leavers and keeps total + houseOutstanding + stacks constant', ...)
// table-runtime.persistence.spec.ts
it('does not start the next hand until persistHand resolves', ...)
it('records every action of the hand in the HandRecord (blinds included)', ...)
it('a failing persistHand marks the table degraded, retries at 1/2/4/8/15 s and resumes', ...)   // failNext('persistHand', 2)
it('a leave during degradation waits for the next successful persistHand', ...)                 // Review Focus 5
it('a failing standUp between hands keeps the player seated and acks INTERNAL', ...)
it('only shown hands go into HandRecord.shownHands', ...)
```

- [ ] **Step 2: Correr y verificar que fallan** — `pnpm --filter @naipes/server test:unit -- table-runtime in-memory-table-store` · FAIL.
- [ ] **Step 3: Implementar** (`table-runtime.ts` ya ronda 500 líneas: poner el armado del `HandRecord` y la política de reintentos en módulos hermanos `hand-recorder.ts` y `persist-retry.ts`).
- [ ] **Step 4: Verificar** — `pnpm --filter @naipes/server test:unit` (todos, incluidos los de la 3a adaptados), `pnpm build:packages`, lint, typecheck · PASS.
- [ ] **Step 5: Commit** — `refactor(server): replace wallet port with a transactional table store`

---

### Task 3: `PrismaTableStore`

**Files:**
- Create: `apps/server/src/tables/prisma-table-store.ts`
- Test: `apps/server/src/tables/prisma-table-store.int-spec.ts`

**Interfaces:**
- Consumes: `TableStore`, `HandRecord` (Task 2); `PrismaClient`, `createTestDatabase`, `auditChips` (Task 1).
- Produces: `class PrismaTableStore implements TableStore { constructor(prisma: PrismaClient) }`. Resuelve `dev:<nombre>` → `profiles.id` por `dev_handle` (lanza si el perfil no existe: la cuenta la crea `AccountService` al conectar). Cada método es un `prisma.$transaction(async tx => ...)`; los débitos usan `$executeRaw` con `UPDATE ... WHERE balance >= ${amount}` y verifican filas afectadas; `balance_after` se toma del `RETURNING`.

- [ ] **Step 1: Tests que fallan**

```ts
it('sitDown with enough balance debits, writes buy_in and inserts the seat', ...)
it('sitDown without balance returns insufficient and changes nothing', ...)
it('two concurrent sitDowns that exceed the balance: exactly one succeeds, balance never negative', ...)
it('standUp deletes the seat, credits the wallet and writes cash_out', ...)
it('bot sitDown/standUp write bot_buy_in/bot_cash_out with user_id null', ...)
it('persistHand writes hand, actions and stacks in one transaction', ...)
it('persistHand pays a human leaver and a bot leaver of the same hand to wallet and house', ...)   // Review Focus 4
it('persistHand is atomic: a failure mid-way leaves no partial rows', ...)                         // forzar con un HandRecord inválido (seat inexistente)
it('no unshown hole card appears in any table', ...)                                                // buscar los ids de cartas en todo el JSON de hands
it('auditChips holds after a sequence of operations', ...)
```

Los perfiles de prueba se insertan directo (helper en `test-database.ts`).

- [ ] **Step 2: FAIL** — `pnpm --filter @naipes/server test:int -- prisma-table-store`
- [ ] **Step 3: Implementar**
- [ ] **Step 4: PASS** + lint + typecheck
- [ ] **Step 5: Commit** — `feat(server): add Prisma table store with ledgered chip movements`

---

### Task 4: `AccountService`: cuenta inicial y recarga diaria

**Files:**
- Create: `apps/server/src/accounts/account.service.ts`, `accounts.module.ts`
- Modify: `apps/server/src/realtime/table.gateway.ts` (al conectar: `ensureAccount` + `applyDailyRefill` antes de aceptar comandos; si fallan, desconectar con error `INTERNAL`), `config/env.ts` (+ `CHIPS_INITIAL`, `CHIPS_DAILY_REFILL_TO`; − `DEV_WALLET_INITIAL`), `.env.example`
- Test: `account.service.int-spec.ts`, ajustes en `table.gateway.spec.ts`

**Interfaces:**
- Produces: `class AccountService { constructor(prisma, opts: { initial: number; refillTo: number }); ensureAccount(devHandle: string): Promise<string /* profileId */>; applyDailyRefill(devHandle: string, now: Date): Promise<number /* chips added, 0 if none */> }`. El gateway pasa `new Date()`; los tests inyectan fechas.

- [ ] **Step 1: Tests que fallan**

```ts
it('creates profile, wallet with 10000 and one initial ledger row', ...)
it('ensureAccount twice (and concurrently ×5) creates one account and one initial', ...)   // Review Focus 1
it('refills to 2000 when balance is below 2000, once per UTC day', ...)                    // 500 → 2000, delta 1500, reason daily_refill
it('does not refill when balance >= 2000', ...)
it('refills again on the next UTC day: 23:59:59Z then 00:00:00Z', ...)                      // Review Focus 2
it('concurrent refills on the same day add chips once', ...)
it('auditChips holds after accounts and refills', ...)
```

- [ ] **Step 2: FAIL** · **Step 3: Implementar** (`INSERT ... ON CONFLICT DO NOTHING` sobre `dev_handle` y la clave de idempotencia `initial`; la recarga como `UPDATE` condicionado del spec §3.4 con `RETURNING` y el asiento del ledger en la misma transacción) · **Step 4: PASS** (int + unit + lint + typecheck)
- [ ] **Step 5: Commit** — `feat(server): create accounts with initial chips and daily refill`

---

### Task 5: `RecoveryService` y cableado del módulo

**Files:**
- Create: `apps/server/src/recovery/recovery.service.ts`
- Modify: `tables.module.ts` (usa `PrismaTableStore`; `PrismaService` con `DATABASE_URL`, o con un Postgres embebido persistente en `apps/server/.local-db/` si `DATABASE_URL` falta y `NODE_ENV !== 'production'`; en producción sin `DATABASE_URL` el arranque falla), `app.module.ts`, `config/env.ts` (`DATABASE_URL`, `DIRECT_URL` opcionales salvo producción), `main.ts` si hace falta el orden de arranque
- Test: `recovery.service.int-spec.ts`, `apps/server/test/persistence.e2e-spec.ts`

**Interfaces:**
- Produces: `class RecoveryService { constructor(prisma); recover(): Promise<{ seats: number; chips: number }> }`, ejecutado en `onApplicationBootstrap` **antes** de que el gateway acepte conexiones (el gateway rechaza conexiones con `UNAUTHORIZED`/`INTERNAL` hasta que `recovery` termine, o el módulo de mesas espera la promesa de recovery en su inicialización).
- Recovery: por cada `seat`, una transacción: acredita (humano) o devuelve a la casa (bot) con `recovery_cash_out` y `idempotency_key = 'recovery:<seat.id>'`, borra el asiento; luego `UPDATE tables SET status='closed', closed_at=now() WHERE status <> 'closed'`.

- [ ] **Step 1: Tests que fallan**

```ts
it('returns every seated stack to its wallet or the house and closes the tables', ...)
it('running recover twice (interrupted then again) never pays a seat twice', ...)       // Review Focus 3
it('auditChips holds after recovery', ...)
// persistence.e2e-spec.ts (server con Postgres embebido)
it('a hand played over Socket.IO is persisted with its actions', ...)
it('after a server restart the player\'s chips are back in the wallet', ...)            // jugar → app.close() → nuevo app con la misma BD → wallet = stack tras la última mano
it('a new user gets 10000 chips on first connection', ...)
```

- [ ] **Step 2: FAIL** · **Step 3: Implementar** · **Step 4:** `pnpm test:server` PASS (unit + int + e2e), lint, typecheck; e2e < 60 s.
- [ ] **Step 5: Commit** — `feat(server): persist tables in Postgres and recover chips on startup`

---

### Task 6: Documentación y cierre

**Files:** `docs/protocol.md` (+ `table:degraded`, cuenta inicial y recarga al conectar, qué pasa al reiniciar), `CLAUDE.md` (Comandos: `db:migrate:dev`, `db:migrate:deploy`, `test:int`; Estado: 3b en curso/pendiente de Supabase; Deuda: retirar "wallet en memoria" y "crédito fallido pierde fichas"), `apps/server/.env.example` (las cuatro variables con comentario sobre transaction pooler 6543 / session pooler 5432 e IPv6)

- [ ] **Step 1:** Escribir los cambios de documentación.
- [ ] **Step 2:** `pnpm lint` · `pnpm typecheck` · `pnpm test` (todo el repo) · PASS.
- [ ] **Step 3: Commit** — `docs: document persistence, chips economy and database commands (phase 3b)`

---

### Paso final (controlador + usuario, no es tarea de subagente)

1. El usuario pega `DATABASE_URL` (transaction pooler, 6543) y `DIRECT_URL` (session pooler, 5432) en `apps/server/.env`.
2. El controlador corre `pnpm db:migrate:deploy` y confirma con el usuario el resultado.
3. Prueba manual del usuario (PowerShell): `$env:PORT = '3111'; pnpm dev:server` + `pnpm play -- --name ana --url http://localhost:3111` → jugar → Ctrl+C al server → arrancarlo de nuevo → reconectar: las fichas siguen.
