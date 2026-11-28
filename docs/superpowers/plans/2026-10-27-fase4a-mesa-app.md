# Fase 4a — Modo Mesa en la app · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jugar Hold'em en tiempo real desde la app contra Render, con la mesa del diseño 4b (animaciones, háptica, sonido) y el menú principal de dos tarjetas.

**Architecture:** Capas: `auth` (supabase-js + secure-store por trozos) → `tableClient` (socket.io, sin React) → `tableStore` (Zustand, máquina de estados de conexión) → `viewModel` (puro: asientos, barra, montos, diff → efectos) → componentes. Saldo por REST con TanStack Query. La UI nunca calcula reglas.

**Tech Stack:** Expo SDK 57, expo-router, Zustand 5, @tanstack/react-query, @supabase/supabase-js, expo-secure-store, socket.io-client, @react-native-community/netinfo, Reanimated, jest-expo + RNTL 14.

**Spec:** `docs/superpowers/specs/2026-10-27-fase4a-mesa-app-design.md` · Diseño visual: `docs/design/fase4-mesa-diseno.md`

## Global Constraints

- Dependencias nativas con `npx expo install <pkg>` (versiones del SDK 57); deben correr en **Expo Go** (nada que requiera development build).
- `serverUrl` por defecto `https://naipes-server.onrender.com`; `EXPO_PUBLIC_SERVER_URL` lo sobrescribe. Supabase: `https://kptoaakzlikfcxerckxe.supabase.co` y la publishable key (públicas) en `app.json` `extra`. Nada secreto en la app.
- Tiempos: `waking` a los **5000 ms**, `failed` a los **90000 ms**, socket cortado **10000 ms** después de pasar a segundo plano, "pendiente" con spinner solo si tarda **> 600 ms**.
- Tokens de color/tipografía solo de `src/theme/tokens.ts`; se agregan `table`, `sizes`, `motion` con los valores exactos del diseño 4b §3.
- Textos solo en `src/i18n/es.ts`, con el copy exacto del diseño 4b §6. Números con separador de miles "." (reusar `src/game/format.ts` si ya formatea así).
- Tests de la app en `src/__tests__/` (nunca en `src/app/`). RNTL 14: `await render(...)`.
- Código y commits en inglés; Conventional Commits.

## Review Focus

- **Vista con `mySeat: null`** (sentado fuera tras perder todo, o aún sin asiento): el view model no debe romper ni rotar mal → test en Task 6.
- **`legal.raise.min > legal.raise.max`** o `raise: null` con `allIn` > 0 (solo queda ir con todo): la barra muestra "Todo" y no Subir → test en Task 6.
- **Updates fuera de orden o repetidos** (`seq` menor o igual al actual tras reconectar): el store ignora el viejo → test en Task 5.
- **Valor de secure-store corrupto o con trozos faltantes**: el adaptador devuelve `null` (se crea un invitado nuevo) en vez de lanzar → test en Task 2.
- **Doble toque en "Mesa rápida"** o volver a la mesa ya sentado: un solo `quickSeat` en vuelo; el servidor devuelve el mismo asiento → test en Task 5.

---

### Task 1: Política de reconexión en `@naipes/shared`

**Files:**
- Create: `packages/shared/src/connection-policy.ts`, `packages/shared/src/connection-policy.test.ts` (mover desde `apps/server/src/dev-client/connection-policy*.ts`, adaptando el spec a Vitest si `shared` usa Vitest)
- Modify: `packages/shared/src/index.ts` (re-exportar), `apps/server/src/dev-client/play.ts:16` (importar de `@naipes/shared`)
- Delete: `apps/server/src/dev-client/connection-policy.ts`, `.spec.ts`

**Interfaces:**
- Produces: `connectErrorAction({ everConnected: boolean; message: string }): 'exit' | 'retry'` y `disconnectAction({ reason: string; leaving: boolean; done: boolean }): 'none' | 'auto' | 'manual'` exportados desde `@naipes/shared`.

- [ ] Mover los tests (mismos casos) y verlos fallar en `shared` antes de mover el código.
- [ ] Mover el código; `pnpm --filter @naipes/shared test` PASS; `pnpm test:server` (unit) PASS; `pnpm typecheck` PASS.
- [ ] Commit: `refactor(shared): move the reconnection policy to the shared package`.

### Task 2: Configuración, dependencias y sesión de invitado

**Files:**
- Modify: `apps/mobile/app.json` (`extra.serverUrl`, `extra.supabaseUrl`, `extra.supabasePublishableKey`), `apps/mobile/package.json` (deps), `apps/mobile/jest.setup.js` (mocks de `expo-secure-store` y netinfo si hace falta)
- Create: `apps/mobile/src/config.ts`, `apps/mobile/src/auth/chunkedSecureStorage.ts`, `apps/mobile/src/auth/session.ts`
- Test: `apps/mobile/src/__tests__/chunked-secure-storage.test.ts`, `apps/mobile/src/__tests__/session.test.ts`

**Interfaces:**
- Produces: `config: { serverUrl: string; supabaseUrl: string; supabasePublishableKey: string }`; `chunkedSecureStorage: { getItem(key): Promise<string|null>; setItem(key, value): Promise<void>; removeItem(key): Promise<void> }`; `ensureGuestSession(): Promise<Session | null>` (null si no hay red/falla); `getAccessToken(): Promise<string | null>`; `onSessionChange(cb: (token: string|null) => void): () => void`.

- [ ] `npx expo install @supabase/supabase-js expo-secure-store socket.io-client @tanstack/react-query @react-native-community/netinfo` (supabase-js y socket.io-client con `pnpm add` si `expo install` no los fija). Verificar que `pnpm dev:mobile` arranca.
- [ ] Tests (RED) del adaptador con `expo-secure-store` en memoria: `'round-trips values of 0 B, 2048 B and 5 KB'`; `'removeItem deletes every chunk'`; `'returns null when a chunk is missing or the count is corrupt'`; `'overwriting a long value with a short one leaves no stale chunks'`. Tamaño de trozo **1800** caracteres; claves `${key}.count` y `${key}.${i}` (sanitizar a `[A-Za-z0-9._-]`).
- [ ] Tests de `session.ts` con `supabase-js` mockeado: `'reuses a stored session'`; `'signs in anonymously when there is none'`; `'returns null instead of throwing when sign-in fails'`.
- [ ] Implementar (`createClient` con `storage: chunkedSecureStorage`, `autoRefreshToken`, `persistSession`, `detectSessionInUrl: false`; `AppState` → `startAutoRefresh/stopAutoRefresh`). GREEN; `pnpm test:mobile` PASS.
- [ ] Commit: `feat(mobile): guest session with Supabase and chunked secure storage`.

### Task 3: Saldo por REST (`/v1/me`)

**Files:**
- Create: `apps/mobile/src/api/me.ts`, `apps/mobile/src/api/queryClient.ts`
- Modify: `apps/mobile/src/app/_layout.tsx` (QueryClientProvider; dispara `ensureGuestSession()` sin esperar)
- Test: `apps/mobile/src/__tests__/me-api.test.ts`

**Interfaces:**
- Consumes: `getAccessToken`, `config.serverUrl`.
- Produces: `fetchMe(): Promise<MeResponse>` (valida con `meResponseSchema`; 401 → refrescar sesión y reintentar 1 vez; otro error → lanza); `useMe(): UseQueryResult<MeResponse>` con `queryKey: ['me']`; `lastKnownBalance(): Promise<number|null>` guardado en `expo-sqlite/kv-store` (`me.lastBalance`) en cada `fetchMe` exitoso; `invalidateMe()`.

- [ ] Tests (RED) con `fetch` mockeado: `'parses /v1/me and stores the last balance'`; `'retries once after a 401'`; `'throws on an invalid body'`.
- [ ] Implementar; GREEN. Commit: `feat(mobile): fetch the wallet balance from /v1/me`.

### Task 4: `tableClient` (socket, sin React)

**Files:**
- Create: `apps/mobile/src/table/tableClient.ts`, `packages/shared/src/server-messages.ts` (+ test)
- Test: `apps/mobile/src/__tests__/table-client.test.ts` (socket.io-client mockeado con un emisor falso)

**Interfaces:**
- Produces (shared): `isTableUpdate(x: unknown): x is TableUpdate` — chequeo estructural mínimo (`tableId` string, `seq` entero ≥ 0, `view` objeto con `seats` array, `events` array, `turn` null u objeto con `seat`/`endsInMs` números, `names` objeto); `isTableClosed`, `isTableDegraded`.
- Produces (app): `createTableClient(deps: { url: string; getToken: () => Promise<string|null>; io?: typeof io }): TableClient` con `connect(): void`, `quickSeat(buyIn?: number): Promise<Ack<{tableId: string; seat: number}>>`, `act(seq: number, action: PlayerAction): Promise<Ack>`, `sitOut()`, `sitIn()`, `leave(): Promise<Ack<{cashOut: number|null}>>`, `sync(): void`, `disconnect(): void`, `on(listener: (e: ClientEvent) => void): () => void`, con `ClientEvent = { type: 'status'; status: 'connecting'|'connected'|'reconnecting'|'offline'|'unauthorized' } | { type: 'update'; update: TableUpdate } | { type: 'closed'; closed: TableClosed } | { type: 'degraded'; degraded: TableDegraded } | { type: 'replaced' } | { type: 'error'; error: SocketError } | { type: 'invalid' }`.
- Payloads y eventos: exactamente `SOCKET_EVENTS` y los request schemas de `@naipes/shared` (`table:act` lleva `{ tableId, seq, action }` según `actRequestSchema`).

- [ ] Tests (RED): `'connects with auth.token from getToken'`; `'emits update for a valid table:update and invalid (plus sync) for a malformed one'`; `'after reconnecting it sends table:sync'`; `'io server disconnect reconnects manually (disconnectAction manual)'`; `'UNAUTHORIZED refreshes the token once, then reports unauthorized'`; `'act sends tableId and seq'`.
- [ ] Implementar (`io(url, { transports: ['websocket'], auth: cb => getToken().then(t => cb({ token: t })), reconnection: true })`; decisiones con `connectErrorAction`/`disconnectAction`). GREEN.
- [ ] Commit: `feat(mobile): socket table client`.

### Task 5: `tableStore` (Zustand)

**Files:**
- Create: `apps/mobile/src/table/tableStore.ts`
- Test: `apps/mobile/src/__tests__/table-store.test.ts` (TableClient falso + `jest.useFakeTimers()`)

**Interfaces:**
- Consumes: `TableClient`.
- Produces: `createTableStore(client: TableClient, now?: () => number)` → hook Zustand con estado `{ status: 'idle'|'connecting'|'waking'|'seated'|'reconnecting'|'failed'|'closed'|'replaced'; update: TableUpdate|null; prev: TableUpdate|null; turnReceivedAt: number; pendingAction: boolean; toast: string|null; leftWith: number|null; degraded: boolean; error: SocketError|null }` y acciones `start(buyIn?)`, `act(action)`, `sitOut()`, `sitIn()`, `leave()`, `retry()`, `dismissToast()`, `reset()`. Singleton `useTableStore` creado con el cliente real.

- [ ] Tests (RED): `'start → connecting → waking after 5000 ms → seated on first update'`; `'failed after 90000 ms without a table'`; `'a disconnect while seated goes to reconnecting, the next update back to seated'`; `'ignores an update with seq <= current'`; `'act sets pendingAction until the next update or error'`; `'STALE_SEQ / NOT_YOUR_TURN / INVALID_AMOUNT set a toast and call sync'`; `'closed and replaced are terminal'`; `'leave stores leftWith from cashOut'`; `'start twice sends a single quickSeat'`; `'quickSeat error → failed with error'`; `'degraded true/false toggles the flag'`; `'background for 10000 ms disconnects; foreground reconnects'` (exponer `onAppState(state)`).
- [ ] Implementar; GREEN. Commit: `feat(mobile): table store with connection states`.

### Task 6: `viewModel` (puro)

**Files:**
- Create: `apps/mobile/src/table/viewModel.ts`
- Test: `apps/mobile/src/__tests__/table-view-model.test.ts`

**Interfaces:**
- Consumes: `TableUpdate`, `LegalActions`, `HoldemEvent` de `@naipes/shared`.
- Produces:
  - `toTableModel(update: TableUpdate, opts: { now: number; receivedAt: number }): TableModel` con `seats: SeatModel[]` (siempre `config.maxSeats - 1` rivales en orden de óvalo: índice 0 = izquierda baja, luego en sentido horario hasta derecha baja; vacíos incluidos), `hero: SeatModel | null`, `board: (Card|null)[5]`, `pots: { main: number; sides: number[] }`, `handLabel: string|null`, `actionBar: ActionBarModel`, `timer: { seat: number; fraction: number; low: boolean } | null`, `blinds: { small: number; big: number }`.
  - `SeatModel = { seat: number; name: string|null; stack: number; streetBet: number; isButton: boolean; state: 'empty'|'waiting'|'turn'|'folded'|'allIn'|'sittingOut'|'disconnected'|'winner'; won: number|null; cards: Card[]|null }`.
  - `ActionBarModel = { kind: 'waiting'; actor: string|null } | { kind: 'sitIn' } | { kind: 'turn'; fold: true; middle: { type: 'check' } | { type: 'call'; amount: number } | { type: 'callAllIn'; amount: number }; right: { type: 'bet'|'raise'; min: number; max: number } | null }`.
  - `quickAmounts(legal: LegalActions, pot: number): { key: 'min'|'half'|'pot'|'all'; amount: number; valid: boolean }[]` — Mín = `min`, ½ bote = `round(pot/2)`, Bote = `pot` (para `raise`, sumando lo que falta pagar: `currentBet + pot`, recortado), Todo = `max`; válido si `min ≤ amount ≤ max`.
  - `diff(prev: TableUpdate|null, next: TableUpdate, mySeat: number|null): Effect[]` con `Effect = 'dealt' | { boardRevealed: number } | { bet: number } | 'streetClosed' | { awarded: { seat: number; amount: number } } | 'myTurnStarted' | 'checked' | 'myAllIn' | 'iWon'` (derivados de `next.events` y de comparar vistas).
  - Nombres de mano para `handLabel` desde i18n por categoría del evaluador.
- [ ] Tests (RED): rotación con 2, 4 y 6 asientos (`mySeat` siempre en `hero`); `mySeat: null` → `hero: null` sin lanzar; cada fila de la tabla de la barra del diseño 4b §1 (incluye "Pagar todo (180)" y `raise: null` con `allIn`); `quickAmounts` con valores recortados e inválidos; botes laterales `{ main, sides }`; temporizador `fraction` y `low` (< 5000 ms); `diff` → efectos para reparto, flop (3), turn (1), apuesta, cierre de calle, pago, mi turno, check.
- [ ] Implementar; GREEN. Commit: `feat(mobile): table view model`.

### Task 7: Componentes compartidos, tokens y sonidos nuevos

**Files:**
- Move: `src/components/roguelike/{PlayingCard,SuitIcon,Sheet}.tsx` → `src/components/shared/`; `src/game/feedback.ts` → `src/feedback/feedback.ts` (actualizar imports del roguelike)
- Modify: `src/theme/tokens.ts` (`table`, `sizes`, `motion` del diseño 4b §3), `scripts/generate-sfx.mjs` (+ `flip`, `turn`, `check`), `src/feedback/feedback.ts` (+3 sonidos), `src/i18n/es.ts` (copy del diseño 4b §6 y verbos de acción)
- Create: `assets/sfx/{flip,turn,check}.wav` (generados)

- [ ] Mover sin cambiar comportamiento; `pnpm test:mobile` (tests del roguelike existentes) PASS; `pnpm lint` y `pnpm typecheck` PASS.
- [ ] Generar sonidos (`node apps/mobile/scripts/generate-sfx.mjs`), registrar licencia en `assets/sfx/LICENSE.md`.
- [ ] Commit: `refactor(mobile): share cards and feedback between modes; add table tokens and sounds`.

### Task 8: Pantalla de la mesa (UI y estados)

**Files:**
- Create: `src/app/table.tsx`, `src/components/table/{TableScreen,OvalTable,SeatBadge,Board,PotLabel,HeroSeat,ActionBar,BetSelector,ConnectionOverlay,TableDialogs,TableMenu,Toast}.tsx`
- Test: `src/__tests__/action-bar.test.tsx`, `bet-selector.test.tsx`, `connection-overlay.test.tsx`, `table-screen.test.tsx`

**Interfaces:**
- Consumes: `useTableStore`, `toTableModel`, `quickAmounts`, tokens y componentes compartidos.
- Produces: ruta `/table` (al montar: `start()`; al salir por navegación: confirmación si hay mano en curso → `leave()`).

- [ ] Tests (RED, RNTL): `ActionBar` muestra exactamente los textos del diseño en cada `ActionBarModel` y llama `act` con `{type:'fold'|'check'|'call'|'bet'|'raise'|'allIn', amount?}`; deshabilitada con `pendingAction`; `BetSelector` deshabilita rápidos inválidos, `+`/`−` con paso = ciega grande, "Todo" requiere segundo toque ("Toca de nuevo para ir con todo"), confirma "Subir a 120"/"Apostar 60"; `ConnectionOverlay` por estado (`connecting` "Buscando mesa…", `waking` + "El servidor está despertando…", `reconnecting` banda, `failed` con Reintentar/Volver); diálogos `closed` ("La mesa se cerró. Tus fichas volvieron a tu saldo.") y `replaced`; salir con mano en curso pide "Si sales ahora, te retiras de esta mano. ¿Salir?"; lector de pantalla: `accessibilityLabel` de asiento "Sol, 2.000 fichas, su turno".
- [ ] Implementar con layout del diseño 4b §1 (óvalo, 360 px, áreas ≥ 48 dp); GREEN; `pnpm lint`.
- [ ] Commit: `feat(mobile): table screen with seats, action bar and bet selector`.

### Task 9: Animaciones, háptica y sonido

**Files:**
- Create: `src/table/useTableEffects.ts` (consume `diff` y dispara feedback), `src/components/table/animations.ts`
- Modify: componentes de la Task 8 (Reanimated)
- Test: `src/__tests__/table-effects.test.ts` (feedback mockeado)

**Interfaces:**
- Consumes: `diff`, `playSound`, háptica de `src/feedback/feedback.ts`, `motion` tokens.

- [ ] Tests (RED): cada `Effect` → sonido/háptica de la tabla del diseño 4b §4 (`dealt`→deal; `boardRevealed`→flip; `bet`→chips; `checked`→check + háptica ligera; `myTurnStarted`→turn + ligera; `myAllIn`→chips + media; `iWon`→win + éxito); nada se reproduce dos veces para el mismo `seq`.
- [ ] Animaciones con Reanimated (reparto escalonado 60 ms, volteo 260 ms, fichas al bote 300 ms, bote al ganador 450 ms, anillo del temporizador con `withTiming` desde `fraction`, latido < 5 s); `useReducedMotion()` → fundidos 150 ms. GREEN.
- [ ] Commit: `feat(mobile): table animations, haptics and sounds`.

### Task 10: Menú principal de dos tarjetas

**Files:**
- Modify: `src/app/index.tsx` (reemplazar el inicio actual), `src/__tests__/home.test.tsx`
- Create: `src/components/menu/{ModeCard,BalanceBadge}.tsx`

**Interfaces:**
- Consumes: `useMe`, `lastKnownBalance`, netinfo, la run guardada del roguelike (lógica que ya usa el inicio actual), router a `/run`, `/seed`, `/table`.

- [ ] Tests (RED): con run guardada → "Continuar run" principal y "Nueva run" secundaria; sin run → solo "Nueva run"; saldo "🪙 10.000" de `useMe`, "—" mientras carga y el último conocido sin red; sin red → "Mesa rápida" deshabilitado + "Sin conexión"; primera vez sin saldo conocido → "Te damos 10.000 fichas al entrar"; volver de `/table` invalida `['me']`.
- [ ] Implementar (diseño 4b §2, ícono de ficha propio, engranaje deshabilitado). GREEN; los tests del roguelike siguen pasando.
- [ ] Commit: `feat(mobile): main menu with roguelike and table modes`.

### Task 11: Verificación y documentación

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` en verde; `pnpm play -- --guest --url https://naipes-server.onrender.com` sigue funcionando (Task 1).
- [ ] Probar en el Galaxy A56 (Expo Go por USB) contra Render el criterio de éxito de la spec (5 puntos) y medir frames en la mesa.
- [ ] `CLAUDE.md`: estado (4a), comandos (`EXPO_PUBLIC_SERVER_URL` para apuntar al server local), deuda nueva si aparece. `docs/protocol.md`: sección "Cliente móvil" (reconexión, background 10 s).
- [ ] Commit: `docs: phase 4a table in the mobile app`.
