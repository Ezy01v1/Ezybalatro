# Protocolo del Modo Mesa (Socket.IO)

Contrato entre el cliente y el servidor para el Texas Hold'em No-Limit en tiempo real (Fase 3a). La fuente de verdad del código está en `packages/shared/src/table-protocol.ts` y `apps/server/src/realtime/table.gateway.ts`. Este documento describe lo que el código hace hoy.

## 1. Conexión y autenticación

- Transporte: Socket.IO 4, `transports: ['websocket']`, mismo puerto que el REST (3000 por defecto).
- La autenticación va en el handshake: `auth: { token }`. El middleware corre en **todas** las conexiones, así que incluso `ping` necesita un token válido. Sin token válido la conexión se rechaza con `connect_error` y mensaje `UNAUTHORIZED`.
- **Fase 3a (identidad de desarrollo):** `token = "dev:<nombre>"`, con nombre de 3 a 20 caracteres `[A-Za-z0-9_]`. Cualquiera puede ser cualquiera. Se rechaza siempre si `NODE_ENV=production`. El `userId` es el token completo (`dev:ana`); los bots tienen ids `bot:<...>`.
- **Fase 3c:** el token será el JWT de Supabase. El resto del protocolo no cambia.
- Un usuario tiene una sola conexión activa (ver sección 6).
- **Cuenta y recarga al conectar (Fase 3b):** antes de aceptar la conexión el servidor asegura la cuenta del usuario (`ensureAccount`): si no existe, la crea con `CHIPS_INITIAL` fichas (10000) y asiento `initial_grant` en el ledger; si ya existe, aplica la recarga diaria. La recarga sube el wallet hasta `CHIPS_DAILY_REFILL_TO` (2000) **una vez por día UTC y solo si el saldo está por debajo**; nunca quita fichas. Conectarse de nuevo no vuelve a pagar nada. Si crear la cuenta o recargar falla, el handshake se rechaza con `connect_error` y `data` = `{ type: 'error', code: 'INTERNAL' }`.

```ts
io('http://localhost:3000', { transports: ['websocket'], auth: { token: 'dev:ana' } });
```

## 2. Cliente → servidor

Todos los mensajes llevan **ack**. El jugador que actúa es siempre el dueño del socket: el `playerId` nunca viaja en el payload (un campo extra es `INVALID_MESSAGE`). Los payloads se validan con Zod (`.strict()`); los montos son enteros positivos.

| Evento | Payload | Ack OK |
|---|---|---|
| `table:quickSeat` | `{ buyIn?: int }` (también se acepta sin payload). Sin `buyIn`: `min(maxBuyIn, saldo)` | `{ ok: true, tableId, seat }` |
| `table:act` | `{ tableId, seq, action }` | `{ ok: true }` |
| `table:sitOut` | `{ tableId }` | `{ ok: true }` |
| `table:sitIn` | `{ tableId, postBlindsToEnter?: boolean }` | `{ ok: true }` |
| `table:leave` | `{ tableId }` | `{ ok: true, cashOut: int \| null }` |
| `table:sync` | `{ tableId }` | `{ ok: true, update: TableUpdate }` |
| `ping` | (sin payload) | `{ type: 'pong', serverTime }` |

- `table:quickSeat` es idempotente: si el usuario ya tiene asiento devuelve esa mesa, sin nuevo buy-in. Al sentarse, el servidor le envía enseguida un `table:update` con la vista actual.
- `table:leave`: `cashOut` es el monto devuelto al wallet. Es `null` si el usuario está en una mano: sale al liquidarse y el cash-out llega como evento `playerLeft` en un `table:update`.
- `table:sync` devuelve la vista actual sin esperar un cambio (útil para resincronizar).
- `action` es una de:

```json
{ "type": "fold" }
{ "type": "check" }
{ "type": "call" }
{ "type": "bet", "amount": 120 }
{ "type": "raise", "to": 300 }
{ "type": "allIn" }
```

`bet.amount` y `raise.to` son "apostar/subir **a**" (total comprometido en la calle), no el incremento.

Ejemplo de `table:act` y su ack:

```json
// cliente → servidor
{ "tableId": "e15c5977-5ece-4606-8cee-8752c78e6b05", "seq": 42, "action": { "type": "raise", "to": 100 } }
// ack
{ "ok": true }
// ack de error
{ "ok": false, "error": { "type": "error", "code": "INVALID_AMOUNT", "message": "..." } }
```

## 3. Servidor → cliente

### `table:update`

```ts
interface TableUpdate {
  tableId: string;
  seq: number;
  events: HoldemEvent[];                      // lo ocurrido desde el update anterior
  view: TableView;                            // vista completa de ESTE jugador
  turn: { seat: number; endsInMs: number } | null;
}
```

Se emite a cada usuario por separado, con su propia `viewFor`. Es la vista completa, no un diff: si se pierde un mensaje, el siguiente corrige. Tras reconectar, el snapshot llega con `events: []`.

- `turn.endsInMs` es **relativo al momento en que llegó el update** (no depende del reloj del teléfono). El cliente cuenta desde que lo recibe.
- `view.legal` es no nulo solo cuando es tu turno e incluye los montos permitidos:

```json
{
  "tableId": "e15c5977-...",
  "seq": 42,
  "events": [
    { "type": "playerActed", "seat": 1, "action": "raise", "amount": 100, "to": 120, "allIn": false }
  ],
  "view": {
    "config": { "maxSeats": 6, "smallBlind": 10, "bigBlind": 20, "minBuyIn": 400, "maxBuyIn": 2000 },
    "seats": [ { "seat": 0, "playerId": "dev:ana", "stack": 1980, "status": "seated", "owesBigBlind": false, "owesSmallBlind": false, "postBlindsToEnter": false }, null ],
    "handNumber": 7,
    "mySeat": 0,
    "legal": { "seat": 0, "canCheck": false, "callAmount": 100, "bet": null, "raise": { "min": 200, "max": 1980 }, "allIn": 1980 },
    "hand": {
      "handNumber": 7, "street": "flop", "buttonSeat": 2, "smallBlindSeat": 3, "bigBlindSeat": 4,
      "board": [ { "id": "7s", "rank": 7, "suit": "s" } ],
      "currentBet": 120, "minRaise": 100, "toAct": 0, "pot": 270,
      "players": [ { "seat": 0, "playerId": "dev:ana", "streetBet": 0, "totalBet": 20, "folded": false, "allIn": false,
                     "holeCards": [ { "id": "Th", "rank": 10, "suit": "h" }, { "id": "Qs", "rank": 12, "suit": "s" } ] } ],
      "awards": [], "showdown": [], "mucked": []
    }
  },
  "turn": { "seat": 0, "endsInMs": 18400 }
}
```

### `table:closed`

```json
{ "tableId": "e15c5977-...", "reason": "empty" }
```

`reason`: `empty` (sin humanos durante `EMPTY_TABLE_CLOSE_MS`), `shutdown` (el servidor se apaga) o `error` (falló la verificación de conservación de fichas; los stacks se devuelven al inicio de la mano).

### `table:degraded`

```json
{ "tableId": "e15c5977-...", "degraded": true }
```

Comportamiento del cliente: mostrar un aviso discreto ("guardando...", sin acciones nuevas de sentarse) mientras `degraded` sea `true`, seguir mostrando la mesa y quitar el aviso con `degraded: false`; no hace falta reintentar nada, el servidor lo hace solo. Si el servidor se reinicia mientras la mesa está degradada, esa mano no guardada se anula (ver sección 6, punto 6).

`degraded: true` cuando la mano que terminó no se pudo guardar: la mesa no reparte otra mano, no acepta jugadores nuevos (`sit` → `INTERNAL`) y un `leave` queda pendiente (ack con `cashOut: null`) hasta que se guarde. El servidor reintenta solo (1 s, 2 s, 4 s, 8 s y luego cada 15 s) y emite `degraded: false` al lograrlo. Quien se suscribe a una mesa degradada lo recibe junto con su primer `table:update`.

### `session:replaced`

Se emite al socket **viejo** cuando el mismo usuario abre otra conexión, con payload de error y justo antes de desconectarlo:

```json
{ "type": "error", "code": "SESSION_REPLACED", "message": "Another connection replaced this one" }
```

### `ping`

Se responde por ack con `{ "type": "pong", "serverTime": 1790000000000 }` (necesita token como cualquier conexión).

## 4. Semántica de `seq`

Cada mesa tiene un contador `seq` que sube con cada cambio aplicado. `table:act` cita el `seq` del update sobre el que el jugador decidió; si no es el actual, el ack es `STALE_SEQ` y no cambia nada. Así se descartan los duplicados (un reintento llega con un `seq` viejo) y las acciones sobre vistas desactualizadas. Ante `STALE_SEQ`, espera el siguiente `table:update` (o usa `table:sync`) y decide de nuevo.

**Los clientes deben indexar por `tableId`.** Un usuario que salió a mitad de mano y se volvió a sentar puede recibir `table:update` de dos mesas distintas hasta que la mano vieja se liquida. Cada mesa tiene su propio `seq`: guarda el último update por `tableId`, actúa sobre la mesa del último `quickSeat` y usa el `seq` de **esa** mesa.

## 5. Códigos de error

Ack de error: `{ ok: false, error: { type: 'error', code, message } }`. Ningún mensaje incluye cartas.

| Código | Cuándo |
|---|---|
| `INVALID_MESSAGE` | Payload que no pasa el schema (monto negativo/decimal/texto, campos de más, etc.) |
| `NOT_AT_TABLE` | La mesa no existe o el usuario no tiene asiento ahí |
| `NOT_YOUR_TURN` | Actuar fuera de turno |
| `STALE_SEQ` | `seq` distinto del actual |
| `INVALID_AMOUNT` | Monto fuera de rango (apuesta/subida mínima o máxima, buy-in) |
| `INVALID_ACTION` | Acción no permitida ahora (p. ej. `check` con apuesta pendiente) |
| `INSUFFICIENT_CHIPS` | El wallet no alcanza para el buy-in |
| `TABLE_FULL` | Interno: la mesa no tiene asientos libres. El director lo absorbe (prueba otra mesa o crea una nueva), así que en la 3a no se envía a los clientes |
| `TABLE_CLOSED` | La mesa está cerrada o el servidor se apaga |
| `RATE_LIMITED` | Más de `SOCKET_RATE_LIMIT_PER_SEC` mensajes en una ventana de 1 s (aplica solo a los eventos `table:*`, no a `ping` ni a eventos desconocidos; el mensaje se descarta) |
| `UNAUTHORIZED` | Handshake sin token válido (como `connect_error`) o sin identidad en el socket |
| `SESSION_REPLACED` | Solo en el evento `session:replaced` |
| `INTERNAL` | Falla inesperada; se loguea sin cartas ni estado |

## 6. Reconexión y sesión reemplazada

1. **Se corta el socket de un usuario sentado:** arranca la gracia (`DISCONNECT_GRACE_MS`). El asiento sigue `seated`; si le toca actuar, corre el timer de turno normal (timeout = check o fold, y sitting out desde la mano siguiente).
2. **Vuelve dentro de la gracia** (nueva conexión, misma identidad): se cancela la gracia y recibe un `table:update` completo con su vista y sus cartas. No hace falta volver a hacer `quickSeat` ni suscribirse.
3. **Vence la gracia:** el servidor lo pasa a `sitOut`.
4. **Más de `SITTING_OUT_MAX_MS` fuera:** el servidor lo saca de la mesa y le devuelve las fichas al wallet.
5. **Segunda conexión del mismo usuario:** la nueva queda como activa y recibe el snapshot; la vieja recibe `session:replaced` y se desconecta (`io server disconnect`, así que socket.io-client no reconecta solo). Ser reemplazado no cuenta como desconexión.
6. **Apagado o reinicio del servidor:** cada mesa anula su mano en curso (los stacks vuelven al estado previo), se acreditan los stacks al wallet y se emite `table:closed { reason: 'shutdown' }`; después se cierran los sockets (espera máxima de 2 s para vaciar los buffers). El cliente ve un cierre de transporte y socket.io reconecta solo (los intentos fallidos mientras el servidor está caído son normales). **Fase 3b (persistencia):** las mesas, asientos y manos viven en Postgres, pero las mesas del proceso anterior no se reanudan. Si el apagado fue limpio, cada mesa cierra y devuelve los stacks al wallet; si la última mano no se había guardado, se anula y el wallet recibe el stack de antes de esa mano (en ese caso los `cashOut` anunciados en `playerLeft` o en el ack de `table:leave` pueden no coincidir con lo que se acredita en el siguiente arranque). Si el proceso murió de golpe, al arrancar la recuperación cierra las mesas abiertas que quedaron y devuelve cada asiento humano al wallet (las fichas de los bots no se acreditan a nadie), todo con asientos en el ledger. El servidor siempre arranca sin mesas. Tras reconectar, la mesa vieja ya no existe, el wallet tiene las fichas, así que hay que hacer `quickSeat` otra vez; `table:quickSeat` es idempotente, por lo que el cliente de referencia lo envía en **cada** conexión (también la primera). Si el servidor corta con `io server disconnect` (por ejemplo `session:replaced`), socket.io **no** reconecta solo: el cliente de referencia sale tras `session:replaced` y, en cualquier otro corte iniciado por el servidor, llama a `socket.connect()`.

## 7. Garantías de privacidad

- Al cliente solo llegan su `viewFor` y los `HoldemEvent`, que por diseño no llevan cartas privadas antes del showdown.
- Las cartas de otro jugador aparecen únicamente tras mostrarse en el showdown (`view.hand.showdown` y el evento `showdown`). Los que hacen muck no las muestran.
- El mazo, las cartas quemadas y el estado interno de la mesa no salen del runtime: no van en payloads, errores ni logs. Los payloads de los mensajes y los tokens tampoco se loguean.
- El jugador que actúa lo decide el servidor a partir del socket autenticado, nunca el payload.

## 8. Timers (valores por defecto, configurables por env)

| Variable | Default | Qué controla |
|---|---|---|
| `BETWEEN_HANDS_MS` | 3000 | Pausa entre el fin de una mano y el reparto siguiente |
| `TURN_TIMEOUT_MS` | 20000 | Tiempo para actuar; al vencer: check si es gratis, si no fold, y sitting out desde la mano siguiente |
| `DISCONNECT_GRACE_MS` | 45000 | Gracia tras cortarse el socket antes de pasar a `sitOut` |
| `SITTING_OUT_MAX_MS` | 300000 | Máximo sentado fuera antes de liberar el asiento y devolver las fichas |
| `EMPTY_TABLE_CLOSE_MS` | 60000 | Una mesa sin humanos se cierra tras este tiempo |
| `SOCKET_RATE_LIMIT_PER_SEC` | 10 | Mensajes por segundo y por conexión |
| `BOT_DELAY_MIN_MS` / `BOT_DELAY_MAX_MS` | 800 / 2500 | Tiempo simulado de "pensar" de los bots |

Otras variables de la mesa: `TABLE_SMALL_BLIND` (10), `TABLE_BIG_BLIND` (20), `TABLE_MIN_BUY_IN` (400), `TABLE_MAX_BUY_IN` (2000), `TABLE_MAX_SEATS` (6), `TABLE_BOT_FILL_TARGET` (4), `CHIPS_INITIAL` (10000), `CHIPS_DAILY_REFILL_TO` (2000). Ver `apps/server/.env.example`.

## 9. Cliente de consola

`pnpm play -- --name ana [--url http://localhost:3000] [--buy-in 1000]` compila el servidor y abre un cliente de texto (`apps/server/src/dev-client/`). Comandos: `f` fold · `k` check · `c` call · `b <n>` bet · `r <n>` raise a · `a` all-in · `sitout` · `sitin` · `leave` · `q` (cierra el socket sin `leave`; si vuelves antes de la gracia, sigues en la misma mesa). Si la primera conexión falla o el token es rechazado (`UNAUTHORIZED`) sale con código 1; si el servidor se cae después, muestra "Reconectando..." y vuelve a sentarse.
