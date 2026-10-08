# Fase 3a — Mesa en tiempo real: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mesas de Hold'em NL en memoria, jugables por Socket.IO contra bots, con timers, reconexión y un cliente de consola.

**Architecture:** `TableRuntime` (TypeScript plano, un objeto por mesa) procesa una cola async de comandos sobre el `holdemReducer` del engine, con reloj, mazos y wallet inyectados. `TableDirector` reparte jugadores entre mesas y rellena con bots, que deciden con una función pura del engine sobre su propia `viewFor`. Un gateway Nest/Socket.IO delgado traduce mensajes validados con Zod.

**Tech Stack:** TypeScript strict · NestJS 12 + `@nestjs/websockets` (Socket.IO) · Zod 4 · Vitest + fast-check (engine) · Jest + ts-jest (server) · socket.io-client · Node 24.

**Spec:** `docs/superpowers/specs/2026-10-06-fase3a-mesa-tiempo-real-design.md` (leerlo antes de cada tarea; las secciones citadas como §N son de ahí).

## Global Constraints

- Reglas del juego solo en `packages/engine`. El engine no usa reloj, `Math.random`, `crypto`, timers ni APIs de Node (lo verifica eslint).
- Fichas siempre enteras (`Number.isSafeInteger`).
- Invariante 4: ni `TableState`, ni el mazo, ni cartas privadas salen del runtime: no van en payloads, logs ni mensajes de error. Al cliente solo llega `viewFor` + `HoldemEvent`.
- Invariante 5: el mazo del Modo Mesa se baraja con `crypto.randomInt` (Fisher-Yates).
- Código, nombres y commits en inglés (Conventional Commits). Textos del cliente de consola en español.
- Errores del socket: `{ type: 'error', code, message }`; ack de error: `{ ok: false, error: <eso> }`.
- Defaults (env, §3.7): ciegas 10/20 · buy-in 400–2000 · 6 asientos · relleno con bots hasta 4 · turno 20000 ms · gracia 45000 ms · sitting out máx. 300000 ms · entre manos 3000 ms · cierre de mesa vacía 60000 ms · wallet inicial 10000 · rate limit 10 msg/s · retardo de bots 800–2500 ms.
- Token de desarrollo `dev:<nombre>` (nombre `^[A-Za-z0-9_]{3,20}$`), rechazado con `NODE_ENV=production`.
- Prefijo de ids: humanos `dev:<nombre>`, bots `bot:<nombre>`.
- Windows: no usar heredocs en scripts; los globs de pnpm van entre comillas.

## Review Focus

1. **Montos basura en `table:act`** (negativos, decimales, strings, `NaN`, > 2^53) → `INVALID_MESSAGE` y el estado no cambia. Test en Task 3 (schema) y Task 9 (e2e).
2. **Wallet con menos del buy-in mínimo** al pedir mesa rápida → `INSUFFICIENT_CHIPS`, sin asiento, sin crear mesa, saldo intacto. Test en Task 8.
3. **Dos `quickSeat` simultáneos del mismo usuario** (doble toque) → un solo asiento y un solo débito. Test en Task 8.
4. **`leave` estando all-in** → sigue en la mano hasta liquidar; el cash-out llega con `playerLeft` y es exactamente su stack final. Test en Task 5.
5. **El último humano se va a mitad de mano** con bots jugando → la mesa se cierra a los `EMPTY_TABLE_CLOSE_MS`, la mano en curso se anula y las fichas de los bots vuelven a la casa (conservación global intacta). Test en Task 8.

---

## Mapa de archivos

```
packages/engine/src/bots/
  strength.ts                 preflopStrength, postflopStrength
  strength.test.ts
  personalities.ts            BotPersonality, BotProfile, BOT_PERSONALITIES
  decide.ts                   decideBotAction
  decide.test.ts              casos fijos + determinismo + legalidad (fast-check)
  bots.simulation.test.ts     5.000 manos con 6 bots
packages/engine/src/index.ts  (+ exports)

packages/shared/src/table-protocol.ts       schemas y tipos del Modo Mesa
packages/shared/src/table-protocol.test.ts
packages/shared/src/index.ts                (+ códigos de error, eventos, re-export)
packages/shared/package.json                (+ dependencia @naipes/engine)

apps/server/src/config/env.ts               (+ variables de mesa)
apps/server/src/tables/
  ports.ts                    Scheduler, Timer, DeckSource, WalletPort, TableLogger
  real-scheduler.ts           realScheduler
  crypto-deck-source.ts       CryptoDeckSource
  in-memory-wallet.ts         InMemoryWallet, HouseBankroll
  errors.ts                   toSocketError, socketError
  table-settings.ts           TableSettings, tableSettingsFromEnv
  table-runtime.ts            TableRuntime
  table-director.ts           TableDirector
  tables.module.ts            providers de Nest
  testing/fake-scheduler.ts   FakeScheduler (solo tests)
  testing/table-harness.ts    helpers de tests
  *.spec.ts
apps/server/src/bots/
  bot-player.ts               BotPlayer
  bot-names.ts                BOT_NAMES
  bot-player.spec.ts
apps/server/src/realtime/
  identity.ts                 IdentityPort, DevIdentity
  rate-limiter.ts             SocketRateLimiter
  table.gateway.ts            TableGateway
  *.spec.ts
apps/server/src/dev-client/
  parse-command.ts            parseCommand
  render.ts                   renderTable
  play.ts                     entrypoint del cliente de consola
  *.spec.ts
apps/server/test/table.e2e-spec.ts
docs/protocol.md
```

**Desvío menor del spec (§3.6):** el cliente de consola vive en `apps/server/src/dev-client/` y no en `apps/server/scripts/`, para que lo cubran el typecheck, el lint y jest del server sin configuración extra. Se ejecuta desde `dist` con `pnpm play`. `main.ts` nunca lo importa.

---

### Task 1: Fuerza de manos para bots (engine)

**Files:**
- Create: `packages/engine/src/bots/strength.ts`
- Test: `packages/engine/src/bots/strength.test.ts`

**Interfaces:**
- Consumes: `Card`, `bestHand`, `categoryStrength`, `parseCards` (engine).
- Produces:
  - `preflopStrength(holeCards: readonly [Card, Card]): number` en [0, 1].
  - `postflopStrength(holeCards: readonly [Card, Card], board: readonly Card[]): number` en [0, 1]; `board.length` de 3 a 5.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
const hole = (t: string) => parseCards(t) as [Card, Card];
const board = parseCards;

it('preflop: AA is 1 and the ordering is sane', () => {
  expect(preflopStrength(hole('As Ah'))).toBe(1);
  const order = ['As Ah', 'Ks Kh', 'As Ks', 'As Kd', '2s 2h', '7s 2d'].map((h) => preflopStrength(hole(h)));
  expect(order).toEqual([...order].sort((a, b) => b - a));
  expect(new Set(order).size).toBe(order.length);
});
it('preflop: every one of the 169 classes is in [0, 1]', () => { /* recorre todas las combinaciones de createStandardDeck() */ });
it('postflop: set beats unpaired high card', () => {
  expect(postflopStrength(hole('As Ah'), board('Ad 7c 2s'))).toBeGreaterThan(postflopStrength(hole('Kc Qd'), board('Ah 7c 2s')));
});
it('postflop: a pair on the board alone is not your hand', () => {
  expect(postflopStrength(hole('Ac Kd'), board('7c 7d 2s'))).toBe(0.15);
});
it('postflop: flush draw adds 0.15 on flop and turn, nothing on the river', () => {
  expect(postflopStrength(hole('Ah 5h'), board('Kh 9h 2c'))).toBeCloseTo(0.3);
  expect(postflopStrength(hole('Ah 5h'), board('Kh 9h 2c 3d Js'))).toBe(0.15);
});
it('postflop: open-ended straight draw adds 0.12', () => {
  expect(postflopStrength(hole('9c 8d'), board('7h 6s 2c'))).toBeCloseTo(0.27);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm --filter @naipes/engine exec vitest run src/bots/strength.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `strength.ts`**

- **Preflop:** fórmula de Chen sobre la clase de mano (pareja, suited u offsuit), normalizada a [0, 1] con `(chen + 1) / 21`, acotada. La tabla de las 169 clases se construye una vez, al cargar el módulo, como `ReadonlyMap<string, number>` con claves `'AA'`, `'AKs'`, `'AKo'`.
  - Chen: carta alta A=10, K=8, Q=7, J=6, de T a 2 = rango/2.
  - Pareja: ×2, con mínimo 5.
  - Suited: +2.
  - Gap 1/2/3/≥4 → −1/−2/−4/−5.
  - +1 si el gap es 0 o 1 y la carta alta es menor que Q.
  - Redondear hacia arriba.
- **Postflop:**
  - `MADE = [0.15, 0.45, 0.65, 0.75, 0.82, 0.87, 0.93, 0.98, 1.0]`, indexado por `categoryStrength`.
  - `madeCat` = categoría de `bestHand([...hole, ...board])`.
  - `boardCat`: si el board tiene 5 cartas, la categoría de `bestHand(board)`; si no, por grupos de rango (póker = 7, trío = 3, doble par = 2, par = 1, nada = 0).
  - Base = `madeCat > boardCat ? MADE[madeCat] : 0.15`.
  - Solo con 3 o 4 cartas en el board y `madeCat < 4`:
    - +0.15 por proyecto de color: 4 del mismo palo con al menos una carta propia de ese palo.
    - +0.12 por proyecto de escalera abierta: 4 rangos consecutivos con al menos una carta propia, abierta por los dos lados (el As cuenta como 1 y 14; A-2-3-4 y J-Q-K-A no son abiertas).
  - Acotar a 1.

- [ ] **Step 4: Correr los tests**

Run: `pnpm --filter @naipes/engine exec vitest run src/bots/strength.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/bots
git commit -m "feat(engine): add hand strength heuristics for bots"
```

---

### Task 2: Decisión de los bots (engine)

**Files:**
- Create: `packages/engine/src/bots/personalities.ts`, `packages/engine/src/bots/decide.ts`
- Modify: `packages/engine/src/index.ts` (exportar `decideBotAction`, `preflopStrength`, `postflopStrength`, `BOT_PERSONALITIES`, `BOT_PERSONALITY_IDS` y los tipos `BotPersonality`, `BotProfile`)
- Test: `packages/engine/src/bots/decide.test.ts`, `packages/engine/src/bots/bots.simulation.test.ts`

**Interfaces:**
- Consumes: Task 1; `TableView`, `HoldemAction`, `Rng`, `nextInt` (engine).
- Produces:
  - `type BotPersonality = 'cautious' | 'normal' | 'aggressive'`
  - `const BOT_PERSONALITY_IDS: readonly BotPersonality[]`
  - `interface BotProfile { callMargin: number; raiseAbove: number; bluffPercent: number }`
  - `BOT_PERSONALITIES: Record<BotPersonality, BotProfile>` con los valores cautious `{0.10, 0.80, 5}`, normal `{0, 0.70, 7}` y aggressive `{-0.08, 0.58, 10}`.
  - `decideBotAction(view: TableView, rng: Rng, personality: BotPersonality): HoldemAction | null`. Solo devuelve `fold | check | call | bet | raise | allIn`, con `playerId` = el del asiento `view.mySeat`.

- [ ] **Step 1: Escribir los tests que fallan**

Helpers: armar estados con `tableWith`, `stackedDeck` y `run` de `testing/holdem-fixtures.ts`, y tomar `viewFor(state, playerToAct)`. `constRng(99)` = `{ nextUint32: () => 99 }`, que hace que el farol nunca salga (`99 % 100 >= bluffPercent`).

```ts
it('returns null when it is not the bot turn', ...)            // view.legal === null → null
it('AA preflop never folds, for every personality and seed', ...) // 200 semillas × 3 personalidades: type !== 'fold'
it('72o with nothing to call checks when the bluff roll fails', ...) // BB con 7s 2d tras limps: { type: 'check' }
it('is deterministic for the same rng state', ...)              // createSeededRng('x') dos veces → toEqual
it('aggressive bets or raises more often than cautious', ...)   // 2.000 vistas de una simulación sembrada: count(aggr) > count(caut)
it('every decision is accepted by the reducer (property)', ...) // fc.assert sobre semillas: 6 bots, 100 manos, holdemReducer(...).ok siempre
```

`bots.simulation.test.ts`: 6 bots con buy-in de 2.000 y ciegas 10/20, 5.000 manos con mazos de `shuffleDeck(createSeededRng('sim'), createStandardDeck())`. En cada paso:
- `holdemReducer(...).ok === true`.
- `totalChips(state)` es igual a las fichas metidas en la mesa.

Cuando un bot queda con stack 0, hace `leave` y vuelve a `sit` con buy-in nuevo (sumándolo a lo esperado).

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm --filter @naipes/engine exec vitest run src/bots`
Expected: FAIL en `decide.test.ts` y `bots.simulation.test.ts`.

- [ ] **Step 3: Implementar `personalities.ts` y `decide.ts`**

Algoritmo (§7):

```text
legal = view.legal; if null → null
me = jugador view.mySeat; hole = sus holeCards
s = board vacío ? preflopStrength(hole) : postflopStrength(hole, board)
pot = view.hand.pot; call = legal.callAmount
potOdds = call > 0 ? call / (pot + call) : 0
p = BOT_PERSONALITIES[personality]
stackBB = stack / bigBlind
aggressive = s >= p.raiseAbove || nextInt(rng, 100) < p.bluffPercent
if aggressive and (legal.bet or legal.raise):
    if legal.allIn !== null and stackBB <= 10 and s >= 0.85 → allIn
    f = 0.5 + nextInt(rng, 51) / 100                         // 50 %..100 % del bote
    bet   → amount = clamp(round(pot * f), bet.min, bet.max)
    raise → to = clamp(currentBet + round((pot + call) * f), raise.min, raise.max)
if legal.canCheck → check
if s >= potOdds + 0.15 + p.callMargin → call (s >= raiseAbove sin raise legal → call siempre)
→ fold
```

La tirada de farol se hace siempre, una vez por decisión, para que el consumo del `rng` sea estable.

- [ ] **Step 4: Correr los tests y el lint del engine**

Run: `pnpm --filter @naipes/engine exec vitest run src/bots` y `pnpm --filter @naipes/engine lint`
Expected: PASS, sin errores de lint.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src
git commit -m "feat(engine): add bot decision heuristic with personalities"
```

---

### Task 3: Protocolo del Modo Mesa (shared)

**Files:**
- Create: `packages/shared/src/table-protocol.ts`, `packages/shared/src/table-protocol.test.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/package.json` (dependencia `"@naipes/engine": "workspace:*"`, luego `pnpm install`)

**Interfaces:**
- Produces (exportados desde `@naipes/shared`):
  - `socketErrorCodeSchema`: se agregan `INVALID_ACTION`, `NOT_AT_TABLE`, `INSUFFICIENT_CHIPS`, `TABLE_CLOSED`, `TABLE_FULL`, `SESSION_REPLACED`, `UNAUTHORIZED`, `RATE_LIMITED`.
  - `playerActionSchema` / `PlayerAction` = `{type:'fold'} | {type:'check'} | {type:'call'} | {type:'bet', amount:int>0} | {type:'raise', to:int>0} | {type:'allIn'}`. Enteros con `z.number().int().positive().max(Number.MAX_SAFE_INTEGER)`; `.strict()` en cada variante.
  - `quickSeatRequestSchema` `{ buyIn?: int>0 }` · `actRequestSchema` `{ tableId: string(1..64), seq: int>=0, action }` · `tableRequestSchema` `{ tableId }` (sitOut, leave, sync) · `sitInRequestSchema` `{ tableId, postBlindsToEnter?: boolean }`.
  - `type TableClosedReason = 'empty' | 'shutdown' | 'error'`.
  - `interface TableUpdate { tableId: string; seq: number; events: readonly HoldemEvent[]; view: TableView; turn: { seat: number; endsInMs: number } | null }`.
  - `interface TableClosed { tableId: string; reason: TableClosedReason }`.
  - `type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; error: SocketError }`.
  - `SOCKET_EVENTS` agrega `quickSeat: 'table:quickSeat'`, `act: 'table:act'`, `sitOut: 'table:sitOut'`, `sitIn: 'table:sitIn'`, `leave: 'table:leave'`, `sync: 'table:sync'`, `tableUpdate: 'table:update'`, `tableClosed: 'table:closed'`, `sessionReplaced: 'session:replaced'`.
  - Re-export de tipos: `export type { TableView, HoldemEvent, Card, LegalActions } from '@naipes/engine'`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it.each([-1, 0, 1.5, '100', NaN, 2 ** 53])('rejects bet amount %p', (amount) => {
  expect(actRequestSchema.safeParse({ tableId: 't', seq: 0, action: { type: 'bet', amount } }).success).toBe(false);
});
it('rejects unknown action types and extra keys', ...)   // {type:'steal'}; {type:'fold', playerId:'x'}
it('accepts every valid action', ...)
it('accepts the new socket error codes', ...)
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm --filter @naipes/shared test`
Expected: FAIL.

- [ ] **Step 3: Implementar `table-protocol.ts` y actualizar `index.ts` y `package.json`**

- [ ] **Step 4: Verificar**

Run: `pnpm install` · `pnpm build:packages` · `pnpm --filter @naipes/shared test` · `pnpm --filter @naipes/shared typecheck`
Expected: todo en verde. `pnpm --filter @naipes/server typecheck` sigue en verde.

- [ ] **Step 5: Commit**

```bash
git add packages/shared pnpm-lock.yaml
git commit -m "feat(shared): add table protocol schemas and error codes"
```

---

### Task 4: Puertos, mazo CSPRNG, wallet y configuración (server)

**Files:**
- Create: `apps/server/src/tables/ports.ts`, `real-scheduler.ts`, `crypto-deck-source.ts`, `in-memory-wallet.ts`, `errors.ts`, `table-settings.ts`, `testing/fake-scheduler.ts`
- Modify: `apps/server/src/config/env.ts`, `apps/server/src/config/env.spec.ts`, `apps/server/.env.example`
- Test: `apps/server/src/tables/crypto-deck-source.spec.ts`, `in-memory-wallet.spec.ts`, `errors.spec.ts`, `testing/fake-scheduler.spec.ts`

**Interfaces:**
- Produces:
  - `interface Timer { cancel(): void }`
  - `interface Scheduler { now(): number; schedule(ms: number, fn: () => void): Timer }`
  - `interface DeckSource { nextDeck(): Card[] }`
  - `interface WalletPort { balance(userId: string): Promise<number>; debit(userId: string, amount: number): Promise<boolean>; credit(userId: string, amount: number): Promise<void> }` (`debit` devuelve `false` sin tocar nada si no alcanza).
  - `interface TableLogger { warn(message: string): void; error(message: string, trace?: string): void }`
  - `realScheduler: Scheduler` (con `Date.now` y `setTimeout`, y `unref()` en el timer).
  - `class CryptoDeckSource implements DeckSource`: `shuffleDeck(cryptoRng, createStandardDeck())` con `cryptoRng = { nextUint32: () => randomInt(0, 2 ** 32) }`.
  - `class InMemoryWallet implements WalletPort { constructor(initial: number); total(): number }`: un usuario nuevo arranca con `initial` la primera vez que se lo toca.
  - `class HouseBankroll implements WalletPort { outstanding: number }`: `debit` siempre devuelve `true` y suma a `outstanding`; `credit` resta.
  - `socketError(code: SocketErrorCode, message: string): SocketError`.
  - `toSocketError(e: HoldemError): SocketError`. Mapeo: `NOT_YOUR_TURN` y `INVALID_AMOUNT` → el mismo código · `INVALID_BUY_IN` → `INVALID_AMOUNT` · `NOT_SEATED` → `NOT_AT_TABLE` · el resto → `INVALID_ACTION`. El `message` se conserva (el engine garantiza que no lleva cartas).
  - `interface TableSettings { config: TableConfig; timings: TableTimings; botFillTarget: number; emptyTableCloseMs: number; botDelayMs: { min: number; max: number }; devWalletInitial: number; socketRateLimitPerSec: number }`
  - `interface TableTimings { turnTimeoutMs: number; disconnectGraceMs: number; sittingOutMaxMs: number; betweenHandsMs: number }`
  - `tableSettingsFromEnv(env: Env): TableSettings`.
  - `envSchema` agrega todas las variables de §3.7 más `BOT_DELAY_MIN_MS` (800) y `BOT_DELAY_MAX_MS` (2500), con `z.coerce.number().int()`. Con `.superRefine`: SB < BB, `MIN_BUY_IN` ≤ `MAX_BUY_IN`, `MAX_SEATS` de 2 a 6, `BOT_FILL_TARGET` ≤ `MAX_SEATS` y `BOT_DELAY_MIN` ≤ `BOT_DELAY_MAX`.
  - `class FakeScheduler implements Scheduler { advance(ms: number): Promise<void>; flush(): Promise<void> }`. `advance` ejecuta los timers que vencen, en orden de vencimiento, fijando `now` al instante de cada uno, y después de cada uno hace `await flush()`. `flush` drena la cola de microtareas: `await new Promise(r => setImmediate(r))` repetido 5 veces.

- [ ] **Step 1: Escribir los tests que fallan**
  - Deck: 52 cartas únicas (`isCompleteStandardDeck`). En 52.000 barajadas, chi-cuadrado de la primera carta < 100 (51 grados de libertad; el umbral es holgado a propósito).
  - Wallet: `debit` de más devuelve `false` sin cambiar el saldo; `total()` suma a todos.
  - Errores: la tabla de mapeo completa.
  - Env: los defaults se cargan y `TABLE_SMALL_BLIND=20 TABLE_BIG_BLIND=20` se rechaza.
  - FakeScheduler: `cancel` evita la ejecución y los timers corren en orden.
- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm build:packages; pnpm --filter @naipes/server test:unit -- tables config`
Expected: FAIL.

- [ ] **Step 3: Implementar los archivos y actualizar `.env.example`** (con los defaults y un comentario por variable)
- [ ] **Step 4: Correr los tests**

Run: `pnpm --filter @naipes/server test:unit -- tables config`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): add table ports, CSPRNG deck source and table settings"
```

---

### Task 5: `TableRuntime`: cola, comandos y bucle de manos

**Files:**
- Create: `apps/server/src/tables/table-runtime.ts`, `apps/server/src/tables/testing/table-harness.ts`
- Test: `apps/server/src/tables/table-runtime.spec.ts`

**Interfaces:**
- Consumes: Task 3 (`PlayerAction`, `TableUpdate`, `TableClosedReason`, `SocketError`), Task 4 (puertos, `toSocketError`, `socketError`, `TableTimings`).
- Produces:
  - `type TableMessage = { type: 'update'; update: TableUpdate } | { type: 'closed'; closed: TableClosed }`
  - `type TableListener = (message: TableMessage) => void`
  - `type TableResult<T extends object = object> = Ack<T>` (el mismo tipo que el ack).
  - `type TableStatus = 'open' | 'running' | 'closed'`
  - `interface TableHooks { afterHand(table: TableRuntime): void; playerLeft(table: TableRuntime, playerId: string, cashOut: number): void; changed(table: TableRuntime): void; closed(table: TableRuntime): void }`
  - `interface TableRuntimeDeps { id: string; config: TableConfig; timings: TableTimings; scheduler: Scheduler; deckSource: DeckSource; wallet: WalletPort; house: WalletPort; logger: TableLogger; hooks?: Partial<TableHooks> }`
  - `const isBotId = (id: string) => id.startsWith('bot:')`
  - `class TableRuntime`:
    - `constructor(deps: TableRuntimeDeps)`
    - `readonly id: string` · `get status(): TableStatus` · `get seq(): number` · `get createdAt(): number`
    - `seatOf(playerId): number | null` · `playerIds(): string[]` · `humanCount(): number` · `playerCount(): number` · `hasFreeSeat(): boolean` · `isHandInProgress(): boolean`
    - `stackOf(playerId): number | null` · `chipsOnTable(): number` (stacks + bote, para los tests de conservación)
    - `subscribe(playerId: string, listener: TableListener): () => void` (un listener por `playerId`; volver a suscribirse lo reemplaza; envía de inmediato un `update` con `events: []`)
    - `snapshot(playerId: string): TableUpdate`
    - `sit(playerId: string, buyIn: number, postBlindsToEnter?: boolean): Promise<TableResult<{ seat: number }>>`
    - `act(playerId: string, seq: number, action: PlayerAction): Promise<TableResult>`
    - `sitOut(playerId): Promise<TableResult>` · `sitIn(playerId, postBlindsToEnter?: boolean): Promise<TableResult>`
    - `leave(playerId): Promise<TableResult<{ cashOut: number | null }>>`
    - `close(reason: TableClosedReason): Promise<void>`

Comportamiento (§5.1, §5.2, §6.2):
- **Cola:** todos los comandos públicos pasan por `enqueue`, una cadena de promesas. Una excepción dentro de un comando se registra con `logger.error` (mensaje sin estado ni cartas), aplica `voidHand` si hay mano en curso y devuelve `INTERNAL`.
- **`sit`:**
  1. Con la mesa `closed` → `TABLE_CLOSED`; sin asiento libre → `TABLE_FULL`.
  2. Debita la fuente de fondos (`house` si `isBotId`, si no `wallet`). Si no alcanza → `INSUFFICIENT_CHIPS`.
  3. Aplica el `sit` del reducer en el primer asiento libre. Si falla, acredita de vuelta.
- **`act`:** sin asiento → `NOT_AT_TABLE`; `seq !== this.seq` → `STALE_SEQ`; si no, mapea `PlayerAction` → `HoldemAction` con el `playerId`.
- **Después de cada cambio aplicado:**
  1. `seq++`.
  2. Para cada `playerLeft` del lote: acredita `cashOut` a la fuente que corresponda, llama a `hooks.playerLeft`, descuenta del total esperado y quita al jugador de los suscriptores **después** de enviarle este update.
  3. Notifica a cada suscriptor con `viewFor(state, playerId)`.
  4. Verifica la conservación de la mesa: `chipsOnTable() === expectedChips`. Si falla → `close('error')`.
  5. Si la mano pasó a `settled` o `voided` en este lote → `hooks.afterHand`.
  6. Llama a `hooks.changed` y, si corresponde, programa la próxima mano.
- **Bucle de manos:** si no hay mano en curso, no hay timer de inicio y `nextHandPositions(state) !== null`, programa a `betweenHandsMs` un comando que vuelve a verificar y aplica `postBlinds` con `deckSource.nextDeck()`. Estado: `running` mientras haya mano; `open` si no.
- **`turn`** en cada update: `{ seat: hand.toAct, endsInMs: deadline - now }`, o `null`. En esta tarea el deadline es `now + turnTimeoutMs` sin timer (el timer es Task 6).
- **`leave`** responde `cashOut` = el monto de `playerLeft` si salió al instante; `null` si quedó `leaving`.
- **`close(reason)`:**
  1. Cancela timers y anula la mano en curso.
  2. Saca a todos con `leave`, acreditando wallet o casa.
  3. Envía `{ type: 'closed' }` a todos los suscriptores, pasa a `closed` y llama a `hooks.closed`.
  4. Con `reason: 'error'` no se aplica nada del reducer. Los stacks a devolver salen de `hand.startingStacks` si había mano, o de `seats` si no.

- [ ] **Step 1: Escribir los tests que fallan** (con `FakeScheduler` y un `DeckSource` que entrega mazos fijos de `stackedDeck`)

```ts
it('debits the wallet on sit and refunds when the reducer rejects', ...)
it('starts a hand betweenHandsMs after the second player sits', ...)       // advance(2999) sin mano; advance(1) → handStarted
it('rejects a stale seq without changing state', ...)                    // STALE_SEQ; seq igual
it('rejects acting when not seated', ...)                                 // NOT_AT_TABLE
it('sends each subscriber only its own hole cards', ...)                  // el JSON del update de p0 no contiene las card ids de p1
it('credits the wallet when a player leaves between hands', ...)
it('leave while all-in stays until settle and cashes out the final stack', ...)  // Review Focus 4
it('voids the hand and keeps the table alive when a command throws', ...) // deckSource que lanza en la 2.ª mano → INTERNAL, handVoided, la siguiente mano arranca
it('closes with reason error and refunds starting stacks on a conservation mismatch', ...) // `expectedChips` es `protected`: el test usa una subclase que lo altera
it('keeps wallet + chipsOnTable + house.outstanding constant across 200 hands', ...)
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm --filter @naipes/server test:unit -- table-runtime`
Expected: FAIL.

- [ ] **Step 3: Implementar `TableRuntime` y `table-harness.ts`**

`table-harness.ts` exporta `makeRuntime(overrides?)`, que devuelve `{ runtime, scheduler, wallet, house, messages: Map<playerId, TableMessage[]> }`, y `autoPlay(runtime, scheduler, hands)`, que hace check o call por cada jugador humano de prueba hasta liquidar `hands` manos.

- [ ] **Step 4: Correr los tests**

Run: `pnpm --filter @naipes/server test:unit -- table-runtime`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/tables
git commit -m "feat(server): add table runtime with command queue and hand loop"
```

---

### Task 6: `TableRuntime`: turno, desconexión, sitting out y cierre

**Files:**
- Modify: `apps/server/src/tables/table-runtime.ts`
- Test: `apps/server/src/tables/table-runtime.timers.spec.ts`

**Interfaces:**
- Produces (en `TableRuntime`):
  - `disconnected(playerId: string): void`: arranca la gracia; al vencer encola `sitOut` (ignorando `INVALID_ACTION` si ya estaba fuera).
  - `reconnected(playerId: string): void`: cancela la gracia.
  - `get closing(): boolean` y `stopDealing(): void`: no se programan manos nuevas (para el apagado).

Comportamiento:
- **Timer de turno:** se reprograma cuando cambia `(handNumber, toAct)`. Al vencer encola `timeout` solo si `(handNumber, toAct)` sigue igual.
- **Sitting out:** cuando un asiento pasa a `sitting_out` (por evento `playerSatOut` o por el estado después de un `timeout`), se programa `leave` a `sittingOutMaxMs`. Se cancela con `playerSatIn` o con `playerLeft`.
- `close` cancela todos los timers.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it('auto-checks when free and auto-folds when facing a bet after turnTimeoutMs', ...) // playerActed.auto === 'timeout'
it('the timed-out player sits out from the next hand', ...)
it('turn.endsInMs counts down with the scheduler', ...)
it('disconnect → grace → sitting out; reconnect inside grace cancels it', ...)
it('sitting out for sittingOutMaxMs leaves and credits the wallet', ...)
it('sitIn cancels the sitting-out leave timer', ...)
it('stopDealing prevents the next hand from starting', ...)
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm --filter @naipes/server test:unit -- table-runtime`
Expected: FAIL solo en `table-runtime.timers.spec.ts`.

- [ ] **Step 3: Implementar los timers en `TableRuntime`**
- [ ] **Step 4: Correr los tests**

Run: `pnpm --filter @naipes/server test:unit -- table-runtime`
Expected: PASS (los dos archivos).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/tables
git commit -m "feat(server): add turn, disconnect and sitting-out timers to table runtime"
```

---

### Task 7: `BotPlayer`

**Files:**
- Create: `apps/server/src/bots/bot-player.ts`, `apps/server/src/bots/bot-names.ts`
- Test: `apps/server/src/bots/bot-player.spec.ts`

**Interfaces:**
- Consumes: `TableRuntime` (Task 5/6), `decideBotAction`, `BotPersonality` (Task 2), `Scheduler`, `Rng`.
- Produces:
  - `BOT_NAMES: readonly string[]`: 20 nombres originales en español, sin espacios (`[A-Za-z]`), por ejemplo `Rocio`, `Tano`, `Maru`.
  - `class BotPlayer { constructor(table: TableRuntime, playerId: string, personality: BotPersonality, deps: { scheduler: Scheduler; rng: Rng; delayMs: { min: number; max: number } }); start(): void; stop(): void }`
    - `start()` se suscribe a la mesa.
    - En cada `update` con `view.legal !== null` y sin decisión pendiente para ese `seq`, programa la decisión tras `min + nextInt(rng, max - min + 1)` ms.
    - Al dispararse: `decideBotAction(latest.view, rng, personality)`, quita el `playerId` y llama a `table.act(playerId, latest.seq, action)`.
    - Si recibe `STALE_SEQ` y la vista más reciente todavía le da turno, decide de nuevo enseguida, sin retardo.
    - Con `closed`, o con un `playerLeft` propio, hace `stop()`.
    - `stop()` cancela el timer y se desuscribe.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it('acts within the delay window and only on its turn', ...)
it('re-decides immediately after STALE_SEQ', ...)          // un humano se sienta durante el retardo y sube el seq
it('stops after it leaves or the table closes', ...)
it('three bots play 50 hands alone without errors', ...)    // logger.error no se llama; handSettled ≥ 50
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm --filter @naipes/server test:unit -- bot-player`
Expected: FAIL.

- [ ] **Step 3: Implementar**
- [ ] **Step 4: Correr los tests**

Run: `pnpm --filter @naipes/server test:unit -- bot-player`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/bots
git commit -m "feat(server): add bot players driven by the engine heuristic"
```

---

### Task 8: `TableDirector`: mesa rápida, relleno con bots, cierre y apagado

**Files:**
- Create: `apps/server/src/tables/table-director.ts`
- Test: `apps/server/src/tables/table-director.spec.ts`

**Interfaces:**
- Consumes: Tasks 4–7.
- Produces:
  - `interface DirectorDeps { settings: TableSettings; scheduler: Scheduler; deckSource: DeckSource; wallet: WalletPort; house: WalletPort; logger: TableLogger; botRng: Rng; newTableId: () => string }`
  - `class TableDirector`:
    - `constructor(deps: DirectorDeps)`
    - `quickSeat(userId: string, buyIn?: number): Promise<Ack<{ tableId: string; seat: number }>>`
    - `tableOf(userId: string): TableRuntime | null` · `get(tableId: string): TableRuntime | null` · `tables(): readonly TableRuntime[]`
    - `shutdown(): Promise<void>`

Comportamiento (§5.4, §5.5):
- **`quickSeat`:**
  1. Llamadas concurrentes del mismo usuario comparten la misma promesa (`Map<userId, Promise>`).
  2. Si el usuario ya tiene asiento → devuelve esa mesa sin cobrar.
  3. `buyIn` explícito fuera de [min, max] → `INVALID_AMOUNT`. Sin `buyIn`: `min(maxBuyIn, saldo)`; si es menor que `minBuyIn` → `INSUFFICIENT_CHIPS`, sin crear mesa.
  4. Candidatas: mesas no cerradas con asiento libre, ordenadas por `humanCount` desc y `createdAt` asc.
  5. `runtime.sit` en la primera; con `TABLE_FULL` o `TABLE_CLOSED` prueba la siguiente; si no queda ninguna, crea una mesa nueva.
  6. Después del `sit` exitoso registra `userId → tableId` y llama a `rebalance`.
- **Hooks de cada runtime:**
  - `afterHand` → `rebalance`.
  - `playerLeft` → borra `userId → tableId` si es humano, hace `stop` del `BotPlayer` si es bot y llama a `rebalance` si no hay mano en curso.
  - `changed` → revisa el timer de mesa vacía.
  - `closed` → borra la mesa del mapa.
- **`rebalance(table)`** (privado; no hace nada con la mesa cerrada o con mano en curso, salvo pedir los `leave` de bots, que el engine difiere al final de la mano):
  1. Los bots con stack 0 o en `sitting_out` → `leave`.
  2. Si la mesa está llena y hay bots → un bot hace `leave`.
  3. Mientras `playerCount < botFillTarget` y haya lugar: crea un bot con nombre libre de `BOT_NAMES` y personalidad al azar con `botRng`, hace `sit` con `maxBuyIn` desde la casa y lanza su `BotPlayer`.
- **Mesa vacía:** con `humanCount() === 0`, se programa `close('empty')` a `emptyTableCloseMs`. Se cancela si se sienta un humano.
- **`shutdown`:** `stopDealing` en todas las mesas y después `close('shutdown')` en todas.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it('creates a table and fills it with bots up to botFillTarget', ...)          // 1 humano + 3 bots
it('quickSeat prefers the table with the most humans', ...)
it('quickSeat is idempotent for a seated user', ...)
it('two concurrent quickSeat calls seat once and debit once', ...)              // Review Focus 3
it('INSUFFICIENT_CHIPS without creating a table when the wallet is short', ...) // Review Focus 2 (wallet 300 < min 400)
it('a bot leaves to free a seat when the table is full', ...)                  // 6 jugadores → tras la mano queda 1 libre
it('busted bots are replaced', ...)
it('closes a table emptyTableCloseMs after the last human leaves, even mid-hand', ...) // Review Focus 5: handVoided, house.outstanding vuelve a 0
it('shutdown voids hands and credits every human', ...)
it('global chip conservation with humans joining, playing, disconnecting and leaving', ...)
// wallet.total() + Σ chipsOnTable() − house.outstanding === initial × usuarios, comprobado tras cada advance
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm --filter @naipes/server test:unit -- table-director`
Expected: FAIL.

- [ ] **Step 3: Implementar**
- [ ] **Step 4: Correr todos los tests unitarios del server**

Run: `pnpm --filter @naipes/server test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/tables
git commit -m "feat(server): add table director with quick seat and bot filling"
```

---

### Task 9: Gateway Socket.IO, identidad, rate limit y módulo Nest

**Files:**
- Create: `apps/server/src/realtime/identity.ts`, `rate-limiter.ts`, `table.gateway.ts`, `apps/server/src/tables/tables.module.ts`
- Modify: `apps/server/src/app.module.ts` (importar `TablesModule`)
- Test: `apps/server/src/realtime/identity.spec.ts`, `rate-limiter.spec.ts`, `apps/server/test/table.e2e-spec.ts`, `apps/server/test/table-env.ts`

**Interfaces:**
- Consumes: `TableDirector` (Task 8), schemas de Task 3, `tableSettingsFromEnv` (Task 4).
- Produces:
  - `const IDENTITY = Symbol('IDENTITY')`; `interface Identity { userId: string; displayName: string }`; `interface IdentityPort { authenticate(auth: unknown): Promise<Identity | null> }`
  - `class DevIdentity implements IdentityPort { constructor(nodeEnv: Env['NODE_ENV']) }`: acepta `{ token: 'dev:<nombre>' }` y devuelve `userId = token`, `displayName = nombre`.
  - `class SocketRateLimiter { constructor(limitPerSec: number, now: () => number); allow(key: string): boolean; forget(key: string): void }`, con ventana fija de 1 s.
  - `TablesModule`: provee `TableDirector` (con `useFactory` desde `ConfigService`: `realScheduler`, `CryptoDeckSource`, `InMemoryWallet(devWalletInitial)`, `HouseBankroll`, `new Logger('Tables')`, un `botRng` que envuelve `crypto.randomInt` y `randomUUID`), `IDENTITY` → `DevIdentity` y `TableGateway`. Implementa `OnApplicationShutdown` → `director.shutdown()`.
  - `TableGateway`:
    - `afterInit(server)`: registra un middleware `server.use` que autentica `socket.handshake.auth`. Si falla, responde `next(new Error('UNAUTHORIZED'))`; si no, guarda la identidad en `socket.data.identity`.
    - `handleConnection`: si el usuario ya tenía un socket, emite `session:replaced` al viejo y lo desconecta. Registra el nuevo. Si el usuario tiene mesa, llama a `reconnected` y emite `table:update` con el snapshot.
    - `handleDisconnect`: si es el socket vigente del usuario, lo quita y llama a `table.disconnected(userId)`. Llama a `forget` en el rate limiter.
    - Handlers `@SubscribeMessage` de los 6 eventos de §4.1. Cada uno: rate limit (`RATE_LIMITED`) → `schema.safeParse` (`INVALID_MESSAGE`) → `director.get(tableId)` y verificación de que el usuario está sentado ahí (`NOT_AT_TABLE`) → llamada al runtime → ack.
    - En `quickSeat` exitoso: `table.subscribe(userId, msg => emitir al socket vigente del usuario)`, con `table:update` o `table:closed`.
  - `RealtimeGateway` (`ping`) se conserva sin cambios.

- [ ] **Step 1: Escribir los tests que fallan**

Unitarios:

```ts
it('DevIdentity accepts dev:ana and rejects bad names, missing tokens and production', ...)
it('rate limiter allows N per second and resets the next second', ...)
```

e2e (`table-env.ts` se importa primero y fija `BETWEEN_HANDS_MS=100`, `BOT_DELAY_MIN_MS=10`, `BOT_DELAY_MAX_MS=30`, `TURN_TIMEOUT_MS=3000`, `DISCONNECT_GRACE_MS=1000`, `EMPTY_TABLE_CLOSE_MS=500`). Los clientes de prueba hacen check o call automáticamente cuando `view.legal` no es `null`.

```ts
it('rejects a handshake without a valid token', ...)                       // connect_error message 'UNAUTHORIZED'
it('two humans and bots play a full hand over Socket.IO', ...)             // ambos reciben handSettled
it('A never receives B hole cards before the showdown', ...)               // ninguna card id de B en los payloads de A previos al evento showdown
it('reconnecting mid-hand delivers a snapshot with the own hole cards', ...)
it('a second connection replaces the first with session:replaced', ...)
it('garbage amounts are INVALID_MESSAGE and acting elsewhere is NOT_AT_TABLE', ...) // Review Focus 1
```

`afterAll`: `app.close()` y desconectar todos los clientes.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm --filter @naipes/server test:unit -- realtime` y `pnpm --filter @naipes/server test:e2e`
Expected: FAIL.

- [ ] **Step 3: Implementar el gateway, la identidad, el limitador y el módulo**
- [ ] **Step 4: Verificar todo el server**

Run: `pnpm test:server` y `pnpm --filter @naipes/server lint`
Expected: PASS; el e2e de la mesa termina en menos de 30 s.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): add Socket.IO table gateway with dev identity and rate limiting"
```

---

### Task 10: Cliente de consola, documentación y cierre

**Files:**
- Create: `apps/server/src/dev-client/parse-command.ts`, `render.ts`, `play.ts`, `docs/protocol.md`
- Modify: `package.json` (raíz: script `play`), `CLAUDE.md` (Comandos y Estado actual)
- Test: `apps/server/src/dev-client/parse-command.spec.ts`, `render.spec.ts`

**Interfaces:**
- Consumes: `@naipes/shared` (eventos, schemas, `TableUpdate`, `Ack`).
- Produces:
  - `type Command = { kind: 'act'; action: PlayerAction } | { kind: 'sitOut' } | { kind: 'sitIn' } | { kind: 'leave' } | { kind: 'quit' }`
  - `parseCommand(line: string): Command | { error: string }`. Acepta `f`, `k`, `c`, `b <n>`, `r <n>`, `a`, `sitout`, `sitin`, `leave` y `q`, sin distinguir mayúsculas. Los errores van en español.
  - `renderTable(update: TableUpdate, me: string): string`. Muestra:
    - Una línea por asiento: nombre sin prefijo, stack, apuesta de la calle y marcas `[B]`, `[SB]`, `[BB]`, `← turno`, `(fuera)`, `(retirado)` y `(all-in)`.
    - El bote, el board y tus cartas.
    - Las acciones legales con montos (`call 40`, `raise 80–2000`) y el tiempo de turno en segundos.
    - Los eventos del update en una línea legible en español, por ejemplo `Rocio sube a 120` o `Gana ana: 340`.
    - Cartas en el formato `A♠`, con ♥ y ♦ en rojo ANSI.
  - `play.ts`:
    - Lee `--name` (obligatorio), `--url` (default `http://localhost:3000`) y `--buy-in`.
    - Conecta con `auth: { token: 'dev:<name>' }` y `transports: ['websocket']`, y hace `quickSeat`.
    - En cada `table:update`: limpia la pantalla (`\x1b[2J\x1b[H`) y dibuja `renderTable`.
    - Lee comandos con `node:readline` y envía `act` con el `seq` del último update.
    - Muestra los acks de error como `⚠ CÓDIGO: mensaje`.
    - `q` cierra el socket sin `leave`; `leave` espera el ack y sale.
  - Script raíz: `"play": "pnpm build:packages && pnpm --filter @naipes/server build && node apps/server/dist/src/dev-client/play.js"`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it.each([['f', 'fold'], ['K', 'check'], ['c', 'call'], ['a', 'allIn']])('parses %s', ...)
it('parses b 120 and r 300 as integers', ...)       // { type: 'bet', amount: 120 }, { type: 'raise', to: 300 }
it('rejects b without amount, b -5 and b 1.5', ...)
it('renders own hole cards, pot, board and the turn marker', ...)   // update armado con viewFor sobre tableWith(...)
it('never renders cards it does not have', ...)                     // las cartas de otro jugador no aparecen
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm --filter @naipes/server test:unit -- dev-client`
Expected: FAIL.

- [ ] **Step 3: Implementar `parse-command.ts`, `render.ts` y `play.ts`, y agregar el script `play`**
- [ ] **Step 4: Escribir `docs/protocol.md`**

Contenido:
- Conexión y auth (token de desarrollo; en la 3c, JWT).
- La tabla de eventos de §4.1 y §4.2 con ejemplos JSON.
- Semántica de `seq`.
- Códigos de error.
- Reconexión y sesión reemplazada.
- Garantías de privacidad.
- Valores de los timers.

Actualizar CLAUDE.md:
- **Comandos:** `pnpm play -- --name ana`, y para el teléfono por USB más adelante, `adb reverse tcp:3000 tcp:3000`.
- **Estado actual:** "Hecho: Fase 3a".
- **Deuda técnica:** el wallet y la casa son en memoria (3b); identidad de desarrollo (3c).

- [ ] **Step 5: Verificación completa**

Run: `pnpm lint` · `pnpm typecheck` · `pnpm test`
Expected: todo en verde.

Prueba manual en dos terminales (con `apps/server/.env` copiado de `.env.example`):
1. Correr `pnpm dev:server`.
2. Correr `pnpm play -- --name ana`. Esperado: mesa con 3 bots, mano a los ~3 s, los bots actúan solos.
3. Jugar `c`, `r 100` y `f`. Esperado: un monto ilegal muestra `⚠ INVALID_AMOUNT`.
4. Salir con `q` y volver a correr `pnpm play -- --name ana` antes de 45 s. Esperado: misma mesa y mismo stack.
5. Correr `pnpm play -- --name beto` en otra terminal. Esperado: cae en la mesa de ana.
6. `leave` en ambos. Esperado: la mesa se cierra a los ~60 s (se ve en el log del server).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/dev-client docs/protocol.md package.json CLAUDE.md
git commit -m "feat(server): add console table client and protocol docs (phase 3a)"
```
