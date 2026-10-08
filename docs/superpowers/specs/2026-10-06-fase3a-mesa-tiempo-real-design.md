# Fase 3a — Mesa en tiempo real (sin BD): diseño

Fecha: 2026-10-06 · Estado: aprobado en conversación, pendiente de revisión escrita
Rama: `feat/phase-3a-realtime-table`

## 1. Objetivo y alcance

La Fase 3 (servidor del Modo Mesa) se divide en cuatro subfases, cada una con su spec, su plan y su sesión:

| Subfase | Contenido |
|---|---|
| **3a — Mesa en tiempo real** (este documento) | Runtime de mesas en memoria, gateway Socket.IO, timers, reconexión, barajado CSPRNG, bots, protocolo, cliente de consola. Identidad y wallet provisionales detrás de interfaces. |
| 3b — Persistencia y fichas | Supabase + Prisma, wallets, `chip_ledger`, buy-in/cash-out transaccional, persistencia al liquidar, recuperación tras reinicio (`voided`), recarga diaria. |
| 3c — Cuentas y REST | Invitado de Supabase y verificación del JWT, perfil/nickname, lobby y "mesa rápida" REST, `DELETE /v1/me`, Swagger, pino, helmet. |
| 3d — Deploy | Elegir PaaS (ADR 0006), región, drenado de mesas. |

La UI de la mesa en la app móvil es la Fase 4.

**Éxito de la 3a:** dos personas (o una con dos terminales) pueden sentarse con el cliente de consola en una mesa con bots, jugar manos completas de Hold'em NL según el ADR 0008, desconectarse y volver, y levantarse; sin filtrar cartas privadas y sin crear ni perder fichas.

**Fuera de alcance de la 3a:** base de datos, ledger persistente, recuperación tras reinicio, auth real, endpoints REST, deploy, drenado con espera, espectadores, UI móvil.

## 2. Decisiones de esta subfase

- **Enfoque A:** el runtime de cada mesa es TypeScript plano (sin Nest ni sockets), con reloj, mazos y wallet inyectados. El gateway de Socket.IO es un adaptador delgado.
- **Bots:** heurística simple con tres personalidades. La decisión es una función pura en `packages/engine` que recibe solo la `viewFor` del bot (no puede ver cartas ajenas).
- **Relleno de mesas:** "mesa rápida" llena con bots hasta 4 jugadores; con la mesa llena, un bot se levanta entre manos para dejar lugar.
- **Validación manual:** cliente de consola (`pnpm play`).

## 3. Componentes

### 3.1 `packages/engine` — `bots/`

- `decideBotAction(view: TableView, rng: Rng, personality: BotPersonality): HoldemAction | null`
  - Devuelve `null` si `view.legal` es `null` (no es su turno).
  - Puro y determinista: mismo `view` + mismo estado del `rng` = misma decisión.
- `BotPersonality = 'cautious' | 'normal' | 'aggressive'`, con sus parámetros (umbrales, frecuencia de farol, tamaños de apuesta) como **datos** en un objeto de configuración, no como `if` repartidos.
- `preflopStrength(holeCards): number` (0–1) sobre una tabla de datos de las 169 clases de manos iniciales.
- `postflopStrength(holeCards, board): number` (0–1): categoría de la mano hecha con el evaluador existente (`bestHand`), más bonus por proyecto de color (4 del mismo palo) o de escalera abierta (solo en flop y turn), descontando lo que aporta solo el board (un par en el board no cuenta como mano propia).
- Se exporta desde `packages/engine/src/index.ts`.

### 3.2 `packages/shared` — protocolo

Schemas Zod y tipos de todos los mensajes del Modo Mesa (sección 4), los códigos de error y los nombres de eventos (`SOCKET_EVENTS`). Los usan el server, el cliente de consola y, en la Fase 4, la app. Los tipos de vista (`TableView`, `HoldemEvent`) se reexportan desde el engine; `shared` no los duplica.

### 3.3 `apps/server/src/tables/` (TypeScript plano, sin Nest)

- **`TableRuntime`** (una por mesa)
  - Tiene el `TableState`, el `seq` de la mesa, el estado `open | running | closed` y los suscriptores.
  - Procesa una **cola FIFO async** de comandos de a uno: acciones de humanos y bots, `sit`, `leave`, `sitOut`, `sitIn`, `timeout`, inicio de mano, desconexión y reconexión.
  - Aplica `holdemReducer`; si el resultado es error, el estado no cambia y el error vuelve a quien envió el comando.
  - Después de cada cambio: incrementa `seq` y notifica a cada suscriptor con su `viewFor`, los eventos y el turno.
  - Maneja el timer de turno, la pausa entre manos, la gracia de desconexión y el tiempo máximo en sitting out.
- **`TableDirector`**
  - `Map<tableId, TableRuntime>` y `Map<userId, tableId>` (un asiento por usuario en todo el servidor).
  - "Mesa rápida", relleno y rebalanceo con bots, cierre de mesas sin humanos (sección 5.4).
- **Puertos inyectados**
  - `Scheduler`: `now()`, `setTimeout`, `clearTimeout`. Real en producción; falso (avance manual) en los tests.
  - `DeckSource`: `nextDeck(): Card[]`. Implementación `CryptoDeckSource`: Fisher-Yates con `crypto.randomInt` (invariante 5).
  - `WalletPort`: `balance(userId)`, `debit(userId, amount)`, `credit(userId, amount)`, async. Implementación `InMemoryWallet` en la 3a (saldo inicial configurable). En la 3b se reemplaza por Prisma + `chip_ledger`.
  - `BotRng`: fábrica de `Rng` para las decisiones de los bots (no necesita ser CSPRNG).

### 3.4 `apps/server/src/bots/`

- **`BotPlayer`**: se suscribe a una `TableRuntime` igual que un humano. Cuando le toca, espera un retardo aleatorio (0,8–2,5 s, con el `Scheduler`) y encola la acción de `decideBotAction` por la misma cola que los humanos, citando el `seq` de la vista sobre la que decidió. Si recibe `STALE_SEQ`, vuelve a decidir con la vista nueva.
- Nombres de bots de una lista fija de datos (originales, en español); `playerId` con prefijo `bot:`.

### 3.5 `apps/server/src/realtime/`

- **`TableGateway`**: adaptador Socket.IO ↔ `TableDirector`/`TableRuntime`.
  - Autentica el handshake con un `IdentityPort` (sección 6.4).
  - Valida cada mensaje con los schemas de `shared` y responde por ack.
  - Mantiene `userId → socket` y emite a cada usuario su `table:update`.
  - Rate limit por socket.
- Se registra en `AppModule`; el `RealtimeGateway` actual (`ping`) se conserva.

### 3.6 `apps/server/scripts/play.ts` — cliente de consola

- `pnpm play -- --name ana [--url http://localhost:3000] [--buy-in 1000]`.
- Se conecta con el token de desarrollo `dev:<name>`, hace `table:quickSeat` y dibuja la mesa en texto en cada `table:update`: asientos, stacks, apuestas, bote, board, tus cartas, de quién es el turno y el tiempo restante, y los eventos de la última acción.
- Comandos: `f` (fold), `k` (check), `c` (call), `b <monto>` (bet), `r <monto>` (raise to), `a` (all-in), `sitout`, `sitin`, `leave`, `q` (salir sin levantarse, para probar la reconexión).
- Muestra los errores del servidor con su código.

### 3.7 Configuración (env, validada con Zod en `config/env.ts`)

| Variable | Default |
|---|---|
| `TABLE_SMALL_BLIND` / `TABLE_BIG_BLIND` | 10 / 20 |
| `TABLE_MIN_BUY_IN` / `TABLE_MAX_BUY_IN` | 400 / 2000 |
| `TABLE_MAX_SEATS` | 6 |
| `TABLE_BOT_FILL_TARGET` | 4 |
| `TURN_TIMEOUT_MS` | 20000 |
| `DISCONNECT_GRACE_MS` | 45000 |
| `SITTING_OUT_MAX_MS` | 300000 |
| `BETWEEN_HANDS_MS` | 3000 |
| `EMPTY_TABLE_CLOSE_MS` | 60000 |
| `DEV_WALLET_INITIAL` | 10000 |
| `SOCKET_RATE_LIMIT_PER_SEC` | 10 |

`.env.example` se mantiene sincronizado.

## 4. Protocolo

Se documenta completo en `docs/protocol.md` (se crea en esta subfase).

### 4.1 Cliente → servidor (todos con ack)

| Evento | Payload | Ack OK |
|---|---|---|
| `table:quickSeat` | `{ buyIn?: int }`; sin `buyIn`, el máximo entre `min(maxBuyIn, saldo)` | `{ ok: true, tableId, seat }` |
| `table:act` | `{ tableId, seq, action }` | `{ ok: true }` |
| `table:sitOut` | `{ tableId }` | `{ ok: true }` |
| `table:sitIn` | `{ tableId, postBlindsToEnter?: boolean }` | `{ ok: true }` |
| `table:leave` | `{ tableId }` | `{ ok: true, cashOut: int \| null }`; `null` si está en mano: sale al liquidarla y el cash-out llega como evento `playerLeft` |
| `table:sync` | `{ tableId }` | `{ ok: true, update: TableUpdate }` |

`action` es una de: `{ type: 'fold' }`, `{ type: 'check' }`, `{ type: 'call' }`, `{ type: 'bet', amount }`, `{ type: 'raise', to }`, `{ type: 'allIn' }`. Montos enteros positivos (invariante 8). El `playerId` nunca viene del cliente: lo pone el servidor a partir de la identidad del socket.

Ack de error: `{ ok: false, error: { type: 'error', code, message } }`.

### 4.2 Servidor → cliente

- `table:update` — `TableUpdate = { tableId, seq, events: HoldemEvent[], view: TableView, turn: { seat, endsInMs } | null }`. Se emite a cada usuario por separado con su propia `viewFor`. Es la vista completa (no diffs): ~2 KB para 6 jugadores, se autocorrige si se pierde un mensaje y la reconexión no necesita lógica aparte. `endsInMs` es relativo para no depender del reloj del teléfono.
- `table:closed` — `{ tableId, reason: 'empty' | 'shutdown' | 'error' }`.
- `session:replaced` — antes de cortar una conexión reemplazada.

### 4.3 `seq`

Cada mesa tiene un contador `seq` que sube con cada cambio aplicado. `table:act` cita el `seq` de la vista sobre la que el jugador decidió; si no coincide con el actual, responde `STALE_SEQ` sin cambiar nada. Así se descartan los duplicados (un reintento llega con un `seq` viejo) y las acciones sobre vistas desactualizadas.

### 4.4 Códigos de error del socket

Existentes: `NOT_YOUR_TURN`, `INVALID_AMOUNT`, `STALE_SEQ`, `INVALID_MESSAGE`, `INTERNAL`.
Nuevos: `INVALID_ACTION`, `NOT_AT_TABLE`, `INSUFFICIENT_CHIPS`, `TABLE_CLOSED`, `SESSION_REPLACED`, `UNAUTHORIZED`, `RATE_LIMITED`. (`table:quickSeat` es idempotente, así que no hace falta un código para "ya sentado".)
Los códigos del reducer (`HoldemErrorCode`) se mapean a los del socket en un único lugar del gateway; ningún mensaje de error incluye cartas.

## 5. Ciclo de vida

### 5.1 Bucle de manos

1. Cuando la mano se liquida o se anula, o cuando la mesa pasa a tener al menos 2 jugadores que pueden jugar (`nextHandPositions(state) !== null`), se programa el inicio de mano a `BETWEEN_HANDS_MS`.
2. El inicio de mano encola `postBlinds` con `deckSource.nextDeck()`. La mesa pasa a `running`.
3. Después de cada comando, si cambió `hand.toAct` (o empezó una mano), se reinicia el timer de turno (`TURN_TIMEOUT_MS`); al vencer encola `{ type: 'timeout', playerId }`. Sin turno, no hay timer.
4. Al liquidar: el engine libera los asientos `leaving` con `playerLeft { cashOut }`; el runtime acredita `cashOut` en el `WalletPort` (o en el bankroll de la casa si es un bot). Luego corre el rebalanceo del director (5.4) y se vuelve al paso 1.
5. Si quedan menos de 2 jugadores que pueden jugar, la mesa vuelve a `open` y espera.

### 5.2 Fichas

- **Buy-in de humanos:** `wallet.debit(userId, buyIn)` (falla → `INSUFFICIENT_CHIPS`), luego `sit`. Si `sit` falla, `wallet.credit` de vuelta. Ambos pasos dentro del mismo comando de la cola.
- **Cash-out:** `leave` fuera de mano → `playerLeft` inmediato → `credit`. En mano → sale al liquidar (5.1 paso 4).
- **Bots:** compran con un bankroll de la casa (contador en memoria, sin límite en la 3a). Su cash-out vuelve a ese bankroll. En la 3b quedará en el ledger con un motivo propio.
- **Conservación global** (verificada en tests): `suma(wallets) + suma(stacks) + bote de la mano en curso − bankroll neto entregado a bots` es constante.

### 5.3 Desconexión y reconexión

1. Se corta el socket de un usuario sentado → arranca la gracia (`DISCONNECT_GRACE_MS`). El asiento sigue `seated`; si le toca, corre el timer de turno normal (timeout = check o fold y sitting out desde la mano siguiente, ADR 0008).
2. Vuelve dentro de la gracia (nuevo socket, misma identidad) → se cancela la gracia y recibe `table:update` completo con su vista.
3. Vence la gracia → comando `sitOut`.
4. Más de `SITTING_OUT_MAX_MS` en sitting out (desconectado o no) → comando `leave` y cash-out al wallet.
5. Si el usuario abre una segunda conexión, la anterior recibe `session:replaced` y se corta; la nueva queda como la activa (no cuenta como desconexión).

### 5.4 Director: mesa rápida y bots

- **Mesa rápida:** si el usuario ya tiene asiento, devuelve esa mesa (idempotente) sin nuevo buy-in. Si no, elige, entre las mesas no cerradas con algún asiento libre, la que tenga más humanos (empate: la más antigua); si no hay ninguna, crea una mesa nueva. Se sienta en el primer asiento libre.
- **Rebalanceo** (al crear la mesa y después de cada mano liquidada o anulada, y cuando la mesa está `open` sin mano):
  - Si jugadores < `TABLE_BOT_FILL_TARGET` → entran bots hasta llegar al objetivo (personalidad al azar).
  - Si la mesa está llena y hay al menos un bot → un bot hace `leave` para dejar un asiento libre. Así no hace falta reservar asientos.
  - Los bots que quedan sin fichas se van y el rebalanceo los reemplaza.
- **Cierre:** una mesa sin humanos sentados durante `EMPTY_TABLE_CLOSE_MS` se cierra: los bots se van, la mesa pasa a `closed` y se borra del mapa.

### 5.5 Apagado

En `SIGTERM` (`onApplicationShutdown` de Nest): no se inician manos nuevas, cada mano en curso se anula con `voidHand`, se acreditan los stacks de los humanos al wallet, se emite `table:closed { reason: 'shutdown' }` y se cierran las mesas. El drenado con espera es de la 3d; la recuperación tras reinicio es de la 3b.

## 6. Errores, privacidad y seguridad

### 6.1 Validación

- Payload inválido según Zod → `INVALID_MESSAGE`.
- Error del reducer → su código mapeado en el ack; el estado no cambia.

### 6.2 Fallos internos

- Si un comando lanza una excepción dentro de la cola de una mesa: se loguea (sin cartas, sin estado completo), esa mesa anula la mano en curso con `voidHand` y sigue funcionando; las demás mesas no se ven afectadas.
- Después de cada comando se verifica la conservación de fichas de la mesa (`suma(stacks) + bote` contra el valor esperado). Si falla, la mesa se cierra (`table:closed { reason: 'error' }`) devolviendo a cada humano su stack al inicio de la mano. Esto no debería ocurrir nunca; es una red de seguridad.

### 6.3 Privacidad (invariante 4)

- Al cliente solo llegan su `viewFor` y los `HoldemEvent` (que por diseño no llevan cartas privadas antes del showdown).
- El `TableState`, el mazo y las cartas privadas no salen del runtime: no se loguean, no van en errores ni en mensajes de depuración.

### 6.4 Identidad y abuso

- `IdentityPort.authenticate(handshake): Promise<{ userId, displayName } | null>`.
- Implementación de la 3a, `DevIdentity`: token `dev:<nombre>` (nombre 3–20 caracteres `[a-zA-Z0-9_]`), aceptado solo si `NODE_ENV !== 'production'`. En producción no hay forma de entrar hasta la 3c (Supabase JWT).
- Handshake sin token válido → conexión rechazada con `UNAUTHORIZED`.
- Rate limit por socket: más de `SOCKET_RATE_LIMIT_PER_SEC` mensajes por segundo → `RATE_LIMITED` (el mensaje se descarta).

## 7. Heurística de los bots

1. **Fuerza (0–1):** preflop con `preflopStrength`; postflop con `postflopStrength`.
2. **Pot odds:** `callAmount / (pote + callAmount)`.
3. **Decisión por umbrales de la personalidad:**
   - Fuerza baja: check si se puede; si no, fold, salvo farol (probabilidad `bluffRate` de la personalidad: ~5 % prudente, ~7 % normal, ~10 % agresivo).
   - Fuerza media: check o call si la fuerza supera las pot odds ajustadas por la personalidad; si no, fold.
   - Fuerza alta: bet o raise; tamaño entre 50 % y 100 % del bote (al azar con `rng`), acotado al rango legal; all-in si el rango legal no permite menos o si el stack es corto (≤ 10 ciegas grandes) y la fuerza es muy alta.
4. **Legalidad:** la acción final se ajusta siempre a `view.legal` (montos dentro de `min`/`max`; si una acción no está disponible, se baja a la siguiente legal: raise → call → check → fold).

No pretende jugar bien, solo de forma creíble y distinta según la personalidad.

## 8. Tests

### 8.1 Engine (Vitest + fast-check)

- `decideBotAction` devuelve siempre una acción legal para vistas aleatorias (propiedad).
- Determinismo: mismo `rng` → misma decisión.
- Casos fijos: AA preflop nunca hace fold; 72o sin apuesta a pagar hace check; la personalidad agresiva sube con más frecuencia que la prudente en una muestra fija.
- Simulación de mesa solo con bots: 5.000 manos con 6 bots, conservación de fichas en cada paso y cero errores del reducer.

### 8.2 Server, unitarios con `Scheduler` falso (sin red)

- `TableRuntime`: inicio de mano a los `BETWEEN_HANDS_MS`; timeout de turno → check o fold y sitting out; `STALE_SEQ`; desconexión → gracia → sitting out → `leave` a los `SITTING_OUT_MAX_MS` con cash-out al wallet; reconexión dentro de la gracia; una excepción en un comando anula la mano sin tumbar la mesa.
- `TableDirector`: mesa rápida elige la mesa con más humanos; relleno hasta 4; un bot cede su lugar con la mesa llena; mesa sin humanos se cierra; un usuario no puede tener 2 asientos; mesa rápida es idempotente.
- `CryptoDeckSource`: 52 cartas únicas por mazo; prueba de distribución suave (chi-cuadrado sobre la primera carta en muchas barajadas).
- Conservación global con humanos falsos que entran, actúan, se desconectan y se van durante una simulación larga.

### 8.3 Server, e2e con Socket.IO real

- Dos clientes + bots juegan una mano completa.
- Reconexión a mitad de mano → `table:update` con la vista correcta.
- Segunda conexión del mismo usuario → `session:replaced` en la primera.
- **Privacidad:** ningún payload recibido por el cliente A contiene las cartas privadas de B antes del showdown.
- Handshake sin token → rechazado.

### 8.4 Prueba manual del usuario

Con `pnpm dev:server` corriendo: `pnpm play -- --name ana` → sentarse contra 3 bots, jugar manos, probar fold/call/raise/all-in, `sitout`/`sitin`, `q` y volver dentro de la gracia, y `leave`. En otra terminal, `pnpm play -- --name beto` cae en la misma mesa.

## 9. Criterio de terminado

- `pnpm lint`, `pnpm typecheck` y `pnpm test` en verde.
- `docs/protocol.md` escrito.
- CLAUDE.md actualizado (estado, comandos: `pnpm play`).
- El usuario probó el cliente de consola.
