# Fase 3b — Persistencia y fichas: diseño

Fecha: 2026-10-08 · Estado: aprobado en conversación, pendiente de revisión escrita
Rama: `feat/phase-3b-persistence` · Antecede: Fase 3a (`docs/superpowers/specs/2026-10-06-fase3a-mesa-tiempo-real-design.md`)

## 1. Objetivo y alcance

Las fichas del Modo Mesa dejan de vivir solo en memoria: wallets, asientos y manos liquidadas se guardan en Postgres (Supabase en el server real, Postgres embebido en desarrollo y tests), con cada movimiento asentado en `chip_ledger`.

**Éxito:** un jugador entra, recibe 10.000 fichas, se sienta, juega, se reinicia el server y sus fichas (las del final de la última mano liquidada) están en su wallet; la auditoría global del ledger cuadra; ningún fallo de base de datos crea ni pierde fichas.

**Decisiones del usuario (2026-10-08):**
- Economía: 10.000 iniciales; recarga diaria (día UTC) solo si el saldo es menor a 2.000, que lo sube hasta 2.000 (no acumula).
- Postgres embebido (paquete npm, sin Docker) para tests y desarrollo; Supabase solo para el server real.
- Al reiniciar, los stacks guardados vuelven a los wallets y las mesas arrancan vacías (no se restauran mesas).
- Enfoque A de escritura: transacción en buy-in/cash-out y una transacción por mano liquidada, con el cash-out de quien se fue dentro de esa misma transacción.
- Región de Supabase: East US (Ohio) (jugadores principalmente de México/Centroamérica).

**Fuera de alcance:** Supabase Auth, REST, Swagger (3c) · deploy y drenado (3d) · restaurar mesas tras reinicio · historial de manos para el cliente · UI (Fase 4).

## 2. Modelo de datos

Prisma con migraciones SQL versionadas. Montos `bigint`, fechas `timestamptz` (UTC), PK `uuid`. Restricciones que Prisma no modela (`CHECK`, RLS) se agregan a mano en la migración. RLS activado en todas las tablas y sin políticas (ADR 0005: el cliente nunca accede directo).

| Tabla | Columnas clave | Restricciones |
|---|---|---|
| `profiles` | `id`, `dev_handle` (p. ej. `dev:ana`), `nickname`, `created_at`, `updated_at` | `dev_handle` UNIQUE (nullable, para la 3c) |
| `wallets` | `user_id` (PK, FK profiles), `balance`, `last_daily_refill_at` | `CHECK (balance >= 0)` |
| `chip_ledger` | `id`, `user_id` (NULL = casa), `delta`, `balance_after` (NULL para la casa), `reason`, `table_id`, `hand_id`, `idempotency_key`, `created_at` | `CHECK (delta <> 0)`; `reason` ∈ `initial`, `daily_refill`, `buy_in`, `cash_out`, `recovery_cash_out`, `bot_buy_in`, `bot_cash_out`; UNIQUE (`user_id`, `idempotency_key`) donde la clave no es NULL |
| `tables` | `id`, `status`, `max_seats`, `small_blind`, `big_blind`, `min_buy_in`, `max_buy_in`, `created_at`, `closed_at` | `CHECK max_seats BETWEEN 2 AND 6` |
| `seats` | `id`, `table_id`, `seat_index`, `user_id` NULL, `bot_name` NULL, `stack`, `created_at`, `updated_at` | UNIQUE (`table_id`, `seat_index`); `CHECK (stack >= 0)`; `CHECK` exactamente uno de `user_id`/`bot_name` |
| `hands` | `id`, `table_id`, `hand_number`, `status` (`settled`/`voided`), `button_seat`, `board` jsonb, `awards` jsonb, `shown_hands` jsonb, `settled_at` | UNIQUE (`table_id`, `hand_number`) |
| `hand_actions` | `id`, `hand_id`, `seq`, `seat_index`, `street`, `type`, `amount` | UNIQUE (`hand_id`, `seq`) |

- `seats` contiene solo asientos ocupados: sentarse inserta, levantarse borra.
- **Invariante 4 en la base:** solo se guardan las cartas mostradas en el showdown (`shown_hands`); las de quien tiró sin mostrar no se guardan en ninguna tabla.
- Sin FK a `auth.users` (el Postgres embebido no tiene el schema `auth`); se resuelve en la 3c.
- **Auditoría global** (función de test `auditChips()`): (a) el `balance` de cada wallet es igual a la suma de sus deltas en el ledger; (b) `Σ wallets.balance + Σ seats.stack = Σ deltas (initial + daily_refill) de usuarios − Σ deltas de la casa` (los `bot_buy_in` de la casa son negativos: fichas que la casa puso en mesa; los `bot_cash_out`, positivos).

## 3. Componentes

### 3.1 `apps/server/src/db/`

- `prisma/schema.prisma`, `prisma/migrations/`, `prisma.config.ts` (Prisma estable vigente, verificada al instalar; driver adapter `@prisma/adapter-pg`).
- `PrismaService`: provider Nest; usa `DATABASE_URL`. Las migraciones usan `DIRECT_URL`.
- `EmbeddedDatabase`: helper que levanta un Postgres embebido (paquete npm a elegir y verificar en el plan, debe funcionar en Windows y en GitHub Actions), aplica migraciones y devuelve su URL. Lo usan los tests de integración/e2e y `pnpm dev:server` cuando no hay `DATABASE_URL`.

### 3.2 Puerto `TableStore` (reemplaza a `WalletPort` en el runtime de mesa)

Cada operación es una transacción:

| Operación | Efecto |
|---|---|
| `balance(playerId)` | saldo del wallet (humanos) |
| `openTable(tableId, config)` | inserta `tables` (`open`) |
| `closeTable(tableId)` | `status = closed`, `closed_at` |
| `sitDown({ tableId, seat, playerId, buyIn })` → `'ok' \| 'insufficient'` | humano: `UPDATE wallets SET balance = balance - X WHERE user_id = $u AND balance >= X` (0 filas → `insufficient`) + ledger `buy_in` + insert `seats`; bot: ledger `bot_buy_in` (casa) + insert `seats` |
| `standUp({ tableId, seat, playerId, cashOut })` | borra el asiento + acredita wallet + ledger `cash_out` (bot: ledger `bot_cash_out`) |
| `persistHand(record)` | inserta `hands` + `hand_actions`; `UPDATE seats.stack` de cada asiento; para cada jugador que se fue en esa mano: borra el asiento, acredita y asienta `cash_out`/`bot_cash_out` |

Implementaciones: `PrismaTableStore` (server real) e `InMemoryTableStore` (misma semántica, para los tests unitarios de la 3a, que deben seguir pasando). `InMemoryWallet`/`HouseBankroll` quedan como detalle interno de `InMemoryTableStore` o se retiran.

`HandRecord`: `tableId`, `handNumber`, `status`, `buttonSeat`, `board`, `awards`, `shownHands` (solo lo mostrado), `actions` (seq, seat, street, type, amount), `stacks` (seat → stack), `leavers` (playerId, seat, cashOut).

### 3.3 Cambios en el runtime y el director

- `TableRuntime` registra las acciones de la mano en curso (desde `postBlinds`) para armar el `HandRecord`.
- Buy-in: el runtime llama `store.sitDown` y solo si es `ok` aplica el `sit` del engine; si el engine rechazara (no debería), compensa con `store.standUp` del monto.
- Leave entre manos: `store.standUp` primero; si falla, el jugador sigue sentado (memoria y base) y el ack es `INTERNAL`.
- Mano liquidada o anulada: el runtime difunde el resultado y luego `await store.persistHand(...)` **dentro de la cola**; la siguiente mano no se programa hasta que la transacción confirme.
- Reintentos de `persistHand`: 1 s, 2 s, 4 s, 8 s y luego cada 15 s, sin límite; mientras tanto la mesa está "degradada" (no reparte) y los clientes reciben un aviso (evento nuevo `table:degraded { tableId, degraded: boolean }`).
- El chequeo de conservación de la 3a se mantiene; `expectedChips` se ajusta con los montos confirmados por el store.
- `TableDirector`: usa `TableStore` (abre/cierra mesas en la base; buy-in por defecto con `store.balance`).

### 3.4 `AccountService`

- `ensureAccount(devHandle)`: si no existe, en una transacción crea `profiles`, `wallets` (`CHIPS_INITIAL`) y ledger `initial` con `idempotency_key = 'initial'`. Idempotente ante llamadas concurrentes.
- `applyDailyRefill(userId, now)`: `UPDATE wallets SET balance = $to, last_daily_refill_at = now WHERE user_id = $u AND balance < $to AND (last_daily_refill_at IS NULL OR last_daily_refill_at < date_trunc('day', now UTC))` + ledger `daily_refill` por la diferencia con `idempotency_key = 'refill:<YYYY-MM-DD>'`, en la misma transacción.
- El gateway llama a ambos al conectar (después de autenticar, antes de aceptar comandos). El `userId` del runtime sigue siendo el handle `dev:<nombre>`; el store lo resuelve a `profiles.id`.

### 3.5 `RecoveryService`

Al arrancar el módulo, **antes** de que el gateway acepte conexiones: por cada fila de `seats`, en una transacción, si es humano acredita el stack al wallet; si es bot lo devuelve a la casa; en ambos casos asienta `recovery_cash_out` (con `user_id` NULL para la casa) y borra el asiento; marca todas las mesas no cerradas como `closed`. Idempotente si se interrumpe.

## 4. Configuración y operación

- Env nuevas: `DATABASE_URL` (Supabase **transaction pooler**, puerto 6543; opcional en desarrollo: sin ella se usa el Postgres embebido), `DIRECT_URL` (Supabase **session pooler**, puerto 5432, IPv4; el host directo `db.<ref>.supabase.co` puede ser solo IPv6), `CHIPS_INITIAL=10000`, `CHIPS_DAILY_REFILL_TO=2000`. `DEV_WALLET_INITIAL` se retira.
- En producción (`NODE_ENV=production`) `DATABASE_URL` es obligatoria.
- Comandos: `pnpm db:migrate:dev` (crea/aplica migraciones contra el Postgres embebido), `pnpm db:migrate:deploy` (aplica a la base de `DIRECT_URL`).
- Las contraseñas solo viven en `apps/server/.env` (git-ignorado), escritas por el usuario. Claude puede ejecutar los comandos, nunca ve ni escribe la contraseña.
- Paso final con Supabase: el usuario pega las URLs → Claude corre `pnpm db:migrate:deploy` → prueba manual con `pnpm dev:server` + `pnpm play` (jugar, reiniciar, fichas intactas).

## 5. Errores

- Falla de `sitDown`/`standUp`: el ack es `INTERNAL` (o `INSUFFICIENT_CHIPS`), memoria y base quedan iguales.
- Falla de `persistHand`: mesa degradada con reintentos; nunca se reparte sobre una mano sin guardar. Si el proceso cae en ese lapso, la recuperación devuelve los stacks guardados (esa mano queda en efecto anulada aunque se haya mostrado; caso aceptado por el ADR 0004).
- Logs sin cartas, estados, URLs de conexión ni contraseñas.

## 6. Tests

- **Integración (Postgres embebido, uno por suite, migraciones aplicadas, datos limpios entre tests):** `sitDown` sin saldo → `insufficient` sin efectos; dos buy-ins concurrentes que juntos superan el saldo → solo uno, saldo nunca negativo; el `CHECK (balance >= 0)` rechaza saldo negativo aun forzando SQL; `ensureAccount` y `applyDailyRefill` idempotentes (una sola recarga por día UTC, solo con saldo < 2.000); `persistHand` guarda mano, acciones y stacks, con el cash-out de quien se fue en la misma transacción; las cartas no mostradas no aparecen en ninguna tabla; `RecoveryService` devuelve todo y `auditChips()` cuadra.
- **Fallo de base simulado:** `persistHand` falla dos veces → la mesa no reparte, reintenta, se recupera, conservación intacta.
- **Unitarios de la 3a:** pasan con `InMemoryTableStore`.
- **e2e:** server con base embebida → mano jugada → reinicio → fichas en el wallet.
- **CI:** GitHub Actions corre el Postgres embebido sin cambios de infraestructura.

## 7. Terminado

`pnpm lint`, `pnpm typecheck`, `pnpm test` en verde; migraciones aplicadas en Supabase; prueba manual del usuario (reiniciar sin perder fichas); CLAUDE.md actualizado (estado, comandos, deuda: se retira "crédito fallido pierde fichas" y "wallet en memoria").
