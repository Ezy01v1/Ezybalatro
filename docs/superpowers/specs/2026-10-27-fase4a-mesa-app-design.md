# Fase 4a — Modo Mesa en la app (diseño técnico)

Fecha: 2026-10-27 · Estado: aprobado en conversación, pendiente de revisión escrita
Diseño visual y de interacción: `docs/design/fase4-mesa-diseno.md` (Fase 4b, aprobado). Protocolo: `docs/protocol.md`.

## Objetivo

Jugar Hold'em en tiempo real desde la app contra el servidor de Render, con la mesa completa del diseño 4b (incluidas animaciones, háptica y sonido) y el menú principal de dos tarjetas.

**Criterio de éxito (prueba del usuario en el Galaxy A56, Expo Go, datos móviles, contra `https://naipes-server.onrender.com`):**
1. Abrir la app → menú con saldo → Mesa rápida → jugar varias manos contra bots.
2. Cortar los datos a mitad de mano y volver: "Reconectando…" y la mesa se recupera.
3. Entrar con el servidor dormido: "El servidor está despertando…" y luego la mesa.
4. Salir de la mesa: "Te levantaste con N fichas" y el saldo del menú actualizado.
5. El roguelike sigue funcionando igual, también sin red.

## Decisiones del usuario (2026-10-27)

- Alcance **B: todo junto** (mesa funcional + animaciones + háptica + sonido en esta fase).
- El **menú principal de dos tarjetas** entra en la 4a (la 4c queda para perfil y borrar cuenta).
- Arquitectura **A: capas separadas** (sesión · conexión · store · view model · pantallas).

## Fuera de alcance

Perfil, apodo editable, recarga diaria visible y borrar cuenta (4c) · vincular Google/Apple · elegir asiento, chat, historial, pre-acciones · Maestro (pendiente de Java 17) · build de producción/EAS.

## 1. Configuración

- `apps/mobile/app.config` (o `app.json` + `extra`): `serverUrl` (por defecto `https://naipes-server.onrender.com`, sobrescribible con `EXPO_PUBLIC_SERVER_URL`, p. ej. `http://localhost:3111` vía `adb reverse`), `supabaseUrl` y `supabasePublishableKey` (públicos). Nada secreto en la app.
- Dependencias nuevas (versiones compatibles con Expo SDK 57, instaladas con `npx expo install` cuando aplique): `@supabase/supabase-js`, `expo-secure-store`, `socket.io-client`, `@tanstack/react-query`, `@react-native-community/netinfo` (estado de red para "Sin conexión").

## 2. Capas

```
app/index.tsx (Menú) ─┐                         ┌─ components/table/* (pantalla)
app/table.tsx (Mesa) ─┼─ hooks ─ tableStore (Zustand) ─ tableClient (socket) ─ auth (supabase-js)
                      └─ meQuery (TanStack Query) ─ api (/v1/me) ──────────────┘
                                    viewModel (puro) ◄─ tableStore
```

### 2.1 `auth/` — sesión de invitado
- Cliente `supabase-js` con `storage` = adaptador sobre `expo-secure-store` que **parte en trozos** los valores mayores a ~2 KB (`key.0..n` + `key.count`) y los reensambla; `autoRefreshToken: true`, `persistSession: true`, `detectSessionInUrl: false`. Refresco pausado/reanudado con `AppState`.
- `ensureGuestSession(): Promise<Session>`: devuelve la sesión guardada o hace `signInAnonymously()`. Se dispara en segundo plano al abrir la app; **nunca bloquea** el roguelike.
- `getAccessToken(): Promise<string | null>` para REST y socket.

### 2.2 `api/` — REST
- `fetchMe()` → `GET {serverUrl}/v1/me` con `Authorization: Bearer`; valida con el schema de `@naipes/shared` (`me.ts`). 401 → refrescar sesión y reintentar una vez.
- `useMe()` con TanStack Query (`staleTime` corto, se invalida al volver de la mesa). Último saldo conocido persistido en `expo-sqlite/kv-store` para mostrarlo sin red.

### 2.3 `table/tableClient.ts` — conexión (sin React)
- Envuelve `socket.io-client` con `auth: { token }` y transporte websocket. API:
  - `connect(): void`, `quickSeat(buyIn?: number)`, `act(action: PlayerAction)` (añade el `seq` de la última vista), `sitOut()`, `sitIn()`, `leave()`, `sync()`, `disconnect()`.
  - Emite al store: `update(TableUpdate)`, `closed(TableClosed)`, `degraded(...)`, `replaced()`, `error(SocketError)`, `status(ConnectionStatus)`.
- **Política de reconexión**: se mueve `apps/server/src/dev-client/connection-policy.ts` a `packages/shared` (puro, sin dependencias) y la usan el cliente de consola y la app. Tras reconectar: `table:sync`.
- Token vencido: antes de cada (re)conexión se pide `getAccessToken()` (supabase-js ya lo refrescó). Un error de auth del socket fuerza un refresco y un reintento.
- Todos los mensajes entrantes se validan con los schemas Zod de `@naipes/shared`; uno inválido se descarta y se pide `sync`.

### 2.4 `table/tableStore.ts` — estado (Zustand)
Estado: `status: 'idle' | 'connecting' | 'waking' | 'seated' | 'reconnecting' | 'failed' | 'closed' | 'replaced'`, `update: TableUpdate | null` (última), `prev: TableUpdate | null` (para animaciones), `turnReceivedAt: number`, `pendingAction: boolean`, `toast: string | null`, `leftWith: number | null`.
- Transiciones: `connecting` → (5 s sin mesa) `waking` → (primer `update`) `seated`; (90 s) `failed`. `seated` → (desconexión) `reconnecting` → (`update` tras sync) `seated`. `closed`/`replaced` terminales hasta salir.
- `act()` pone `pendingAction` hasta el siguiente `update` o `error`.
- La UI nunca calcula reglas: solo guarda lo que manda el servidor.

### 2.5 `table/viewModel.ts` — presentación (puro, testeado)
`toTableModel(update, myPlayerId, now) → TableModel`:
- **Asientos**: rotación para que `mySeat` quede abajo; posiciones fijas del óvalo para hasta 5 rivales; estado de cada uno (`waiting | turn | folded | allIn | sittingOut | disconnected | winner | empty`), nombre (`names`), stack, apuesta de la calle, botón D.
- **Centro**: board (5 slots), etiquetas de bote y laterales, nombre de la mano en showdown.
- **Barra de acción** (tabla del diseño 4b §1): textos y habilitación según `view.legal` (`canCheck`, `callAmount`, `bet`, `raise`, `allIn`); caso "Pagar todo".
- **Selector de monto**: `quickAmounts(legal, pot)` → Mín / ½ bote / Bote / Todo **recortados a `[min, max]`** y marcados inválidos si quedan fuera; `step = bigBlind`.
- **Temporizador**: fracción restante a partir de `turn.endsInMs` y `turnReceivedAt` (no del reloj absoluto).
- **Diferencias** `diff(prev, next)` → lista de efectos: `dealt`, `boardRevealed(n)`, `bet(seat)`, `streetClosed`, `awarded(seat, amount)`, `myTurnStarted` — dispara animaciones, háptica y sonidos.

### 2.6 Pantallas y componentes
- `app/index.tsx`: **menú de dos tarjetas** (reemplaza el inicio actual; la run guardada y "Jugar con semilla" se mantienen). `app/table.tsx`: mesa. `app/run.tsx`, `app/seed.tsx` sin cambios.
- Se mueven a `components/shared/`: `PlayingCard`, `SuitIcon`, `Sheet`; y `feedback.ts` a `src/feedback/` (usados por los dos modos). Sin cambios de comportamiento.
- `components/table/`: `TableScreen`, `OvalTable`, `SeatBadge` (con anillo temporizador), `Board`, `PotLabel`, `HeroSeat`, `ActionBar`, `BetSelector`, `ConnectionOverlay`, `TableDialogs`, `TableMenu`.
- Textos nuevos en `i18n` (copy del diseño 4b §6).

### 2.7 Animaciones, háptica y sonido
Reanimated sobre transform/opacity con los tiempos `motion` del diseño 4b §3; disparadas por `diff(prev, next)`; con "reducir movimiento" (`useReducedMotion`) → fundidos de 150 ms. Temporizador con `withTiming` desde la fracción restante. Sonidos nuevos `flip`, `turn`, `check` generados por `apps/mobile/scripts/generate-sfx.mjs` (CC0, sintetizados); reutiliza `deal`, `chips`, `win`. Háptica según la tabla del diseño 4b §4.

### 2.8 Ciclo de vida
- `AppState` a segundo plano: el socket se corta a los 10 s; al volver: reconectar + `sync`. El servidor conserva el asiento 45 s (`DISCONNECT_GRACE_MS`) y luego sienta fuera.
- Salir de la pantalla de mesa por navegación = `leave()` (con la confirmación del diseño si hay mano en curso).

## 3. Errores

| Situación | Comportamiento |
|---|---|
| Sin sesión y sin red al abrir | Menú normal; tarjeta Mesa "Sin conexión"; se reintenta al volver la red |
| `signInAnonymously` falla | Igual que sin red; reintento al tocar Mesa rápida |
| `quickSeat` responde error (`INSUFFICIENT_FUNDS`, …) | Diálogo con el mensaje traducido + volver al menú |
| `STALE_SEQ`, `NOT_YOUR_TURN`, `INVALID_AMOUNT` | Toast breve + `sync` |
| Mensaje inválido del servidor | Descartar + `sync` (log en dev) |
| `table:degraded` | Banda "La mesa está guardando la mano…" sin bloquear |
| 90 s sin mesa | `failed`: Reintentar / Volver al menú |

## 4. Pruebas

- **Unitarias** (jest-expo, `src/__tests__/`): adaptador de secure-store por trozos (valores de 0 B, 2 KB exactos, 5 KB); `viewModel` (rotación con 2–6 asientos, cada fila de la tabla de la barra de acción, montos rápidos recortados, botes laterales, diff → efectos); `tableStore` con un `tableClient` falso (todas las transiciones de §2.4, incluidas 5 s → waking y 90 s → failed con timers falsos); política de reconexión movida (sus tests se mueven con ella).
- **Componentes** (RNTL 14): `ActionBar` en cada situación del diseño, `BetSelector` (rápidos inválidos deshabilitados, "Todo" con doble toque), `ConnectionOverlay` por estado, menú con/sin red y con/sin run guardada.
- **Integración**: `tableClient` contra el servidor real en proceso (embebido) desde los tests del server, reutilizando el cliente de consola: conectar, quickSeat, recibir update, reconectar + sync. (Si el entorno de jest-expo lo complica, este test vive en `apps/server/test` usando el `tableClient` compilado.)
- **Manual**: criterio de éxito arriba, en el Galaxy A56; medir frames en la mesa como en la Fase 2.
- El cliente de consola (`pnpm play`) debe seguir funcionando tras mover la política de reconexión.

## Prueba manual pendiente

Estado: la implementación está terminada en `feat/phase-4a-table`; falta la prueba del usuario en el Galaxy A56 (Expo Go, datos móviles, `https://naipes-server.onrender.com`).

- [ ] 1. Abrir la app: menú con saldo; "Mesa rápida" te sienta y se juegan varias manos contra bots (cartas, acciones, selector de monto).
- [ ] 2. A mitad de mano, cortar los datos móviles y volver a activarlos: aparece "Reconectando…" y la mesa se recupera en la misma mano/mesa.
- [ ] 3. Con el servidor dormido (esperar más de 15 min sin tráfico): entrar a la mesa muestra "El servidor está despertando…" y luego la mesa.
- [ ] 4. Salir de la mesa: "Te levantaste con N fichas" y el saldo del menú coincide con el stack final.
- [ ] 5. El roguelike funciona igual (nueva run, jugar, tienda), también en modo avión.
- [ ] Extra: mandar la app a segundo plano más de 10 s y volver: se reconecta y vuelve a la mesa.
- [ ] Medir frames en la mesa como en la Fase 2 (p50 / p95 / p99 y % de frames tarde) y anotar el resultado aquí.

Para probar contra un servidor local: `$env:EXPO_PUBLIC_SERVER_URL='http://localhost:3111'` y `adb reverse tcp:3111 tcp:3111`.

