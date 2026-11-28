# Fase 5b — Sobres y vales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La tienda del roguelike ofrece 2 sobres y 1 vale además de comodines y consumibles; los sobres se abren y se elige del contenido, los vales cambian reglas de la run de forma permanente.

**Architecture:** Contenido como datos en `packages/engine/src/roguelike/content.ts` (3 sobres, 6 vales). El reducer gana un intérprete de vales (modifica `state.config`) y el estado `openPack` con las acciones `pickFromPack`/`skipPack`. El azar nuevo usa un sub-stream `rng.pack` para no mover lo que ya sortea `rng.shop`. La app solo muestra el estado de la run (Zustand sobre el reducer) y no calcula reglas.

**Tech Stack:** TypeScript strict, Vitest + fast-check (engine), Jest + React Native Testing Library (mobile), Expo/React Native, Zustand.

**Spec:** [2026-11-27-fase5b-sobres-vales-design.md](../specs/2026-11-27-fase5b-sobres-vales-design.md) (padre: [Fase 5](../specs/2026-11-24-fase5-roguelike-profundidad-design.md))

## Global Constraints

- Código, nombres, commits y ramas en inglés; UI en es-419 con textos solo en `apps/mobile/src/i18n/es.ts`. Conventional Commits; **sin líneas de atribución** en los commits.
- Las reglas viven solo en `packages/engine`; la UI nunca calcula reglas. El engine no usa `Math.random`, reloj ni red.
- Contenido como datos: sin `if` por id de sobre o vale en el reducer.
- `RUN_STATE_VERSION` pasa a **3**; las runs guardadas con la 2 se descartan (ya lo hace `loadRun`).
- El sorteo de comodines y consumibles de `rng.shop` **no cambia de orden ni de consumo**; los sobres y vales sortean solo de `rng.pack`.
- `run.shop` queda en este orden: comodines, consumibles, sobres, vale. Los `testID` usan la posición en `run.shop` (`offer-<i>`, `buy-<i>`); la semilla `E2E-9` del flujo Maestro debe seguir dando el comodín `minimalist` en la posición 0.
- Renovar solo vuelve a sortear comodines y consumibles; conserva sobres y vale (y su estado de comprado).
- Funciona a 360 px de ancho, una mano, sin red.
- Antes de dar algo por terminado: `pnpm lint`, `pnpm typecheck`, `pnpm test` desde la raíz (`pnpm lint` ya compila los paquetes).
- Contenido inicial (ids fijos): sobres `pack_joker` (costo 6, 3 opciones, elige 1), `pack_consumable` (4, 3, 1), `pack_card` (5, 3, 1); vales `extra_hand` (10; `hands` +1), `extra_discard` (8; `discards` +1), `joker_slot` (10; `jokerSlots` +1), `consumable_slot` (6; `consumableSlots` +1), `cheap_reroll` (6; `rerollBaseCost` −1), `interest_cap` (8; `interestCap` +1).

## Review Focus

Entradas que el spec implica pero que ninguna prueba "feliz" cubre, de más a menos probable de morder:

1. **Sobre abierto y la app se cierra:** al recargar la run guardada (versión 3) el sobre sigue abierto, con lo ya elegido marcado; una run guardada con la versión 2 se descarta con el aviso de siempre. (Task 4 engine/serialización, Task 9 app.)
2. **Comprar un sobre sin espacio:** de comodines con 5/5 espacios o de consumibles con 2/2 se rechaza (`NO_JOKER_SLOT` / `NO_CONSUMABLE_SLOT`) **sin cobrar**. Elegir un ítem sin espacio dentro de un sobre ya abierto falla sin cambiar nada y el sobre sigue abierto. (Task 4.)
3. **Acciones repetidas o fuera de lugar:** elegir el mismo ítem dos veces, un índice fuera de rango, `pickFromPack`/`skipPack` sin sobre abierto, y `buy`/`reroll`/`leaveShop`/`sellJoker`/`applyConsumable`/`sellConsumable`/`moveJoker` con sobre abierto: todos rechazados sin tocar el estado. (Task 4.)
4. **Vales agotados y efectos inmediatos:** cuando ya se compraron los 6 no hay oferta de vale; un vale de renovar no deja el costo por debajo de 0 y baja también el costo vigente; el `+1 mano`/`+1 descarte` cuenta desde la **siguiente** ciega, no la actual. (Task 3.)
5. **Contenido pequeño:** con un catálogo de comodines casi todos ya poseídos, el sobre ofrece solo los que haya; un sobre que no podría ofrecer ningún ítem se rechaza al comprarlo (`INVALID_OFFER`) sin cobrar. (Task 4.)

---

## File Structure

| Archivo | Responsabilidad |
| --- | --- |
| `packages/engine/src/roguelike/types.ts` | Tipos de contenido: `PackDefinition`, `PackItem`, `VoucherDefinition`, `ConfigModifier`; `RunContent` gana `packs`, `vouchers`. |
| `packages/engine/src/roguelike/content.ts` | `PACKS` y `VOUCHERS` como datos; entran en `DEFAULT_CONTENT`. |
| `packages/engine/src/roguelike/run.ts` | Config, estado, ofertas, compra de vale, sobre abierto, acciones y eventos nuevos. |
| `packages/engine/src/index.ts` | Exporta lo nuevo. |
| `packages/engine/src/roguelike/{content,run,run.property}.test.ts` | Pruebas del motor. |
| `packages/engine/scripts/simulate-balance.mjs` | Política mínima del bot para vales y sobre de comodines. |
| `apps/mobile/src/game/store.ts` | Acciones `pickFromPack` y `skipPack`. |
| `apps/mobile/src/i18n/es.ts` | Textos de sobres y vales (`PACK_TEXTS`, `VOUCHER_TEXTS`, `es.packs`, `es.shop`). |
| `apps/mobile/src/components/roguelike/ShopScreen.tsx` | Secciones Sobres y Vale, lista de vales comprados. |
| `apps/mobile/src/components/roguelike/PackSheet.tsx` (nuevo) | Hoja de apertura del sobre. |
| `docs/design/fase5b-sobres-vales-diseno.md` (nuevo) | Diseño de UI (lo produce `disenador-ui-ux`). |
| `docs/superpowers/specs/2026-11-27-fase5b-sobres-vales-prueba.md` (nuevo) | Checklist manual para el Galaxy A56. |

Comandos de prueba: engine `pnpm --filter @naipes/engine exec vitest run <archivo>`; mobile `pnpm --filter @naipes/mobile test -- <patrón>`. Ayudantes que ya existen en `run.test.ts`: `act`, `errorOf`, `playFirst`, `EASY`, y el patrón `playFirst(createRun('seed', { ...EASY, startingMoney: 50 }).state).state` para llegar a la tienda con dinero.

---

### Task 1: Tipos y contenido de sobres y vales

**Files:**
- Modify: `packages/engine/src/roguelike/types.ts`, `packages/engine/src/roguelike/content.ts`, `packages/engine/src/index.ts`
- Test: `packages/engine/src/roguelike/content.test.ts`

**Interfaces:**
- Produces (en `types.ts`, todo exportado desde `@naipes/engine`):
  ```ts
  type ModifiableConfigKey = 'hands' | 'discards' | 'jokerSlots' | 'consumableSlots' | 'rerollBaseCost' | 'interestCap';
  interface ConfigModifier { readonly key: ModifiableConfigKey; readonly delta: number }
  interface VoucherDefinition { readonly id: string; readonly cost: number; readonly modifiers: readonly ConfigModifier[] }
  type PackKind = 'joker' | 'consumable' | 'card';
  interface PackDefinition { readonly id: string; readonly cost: number; readonly kind: PackKind; readonly size: number; readonly picks: number }
  type PackItem =
    | { readonly kind: 'joker'; readonly jokerId: string }
    | { readonly kind: 'consumable'; readonly consumableId: string }
    | { readonly kind: 'card'; readonly suit: Suit; readonly rank: Rank; readonly enhancement: string };
  ```
  `RunContent` gana `readonly packs: readonly PackDefinition[]` y `readonly vouchers: readonly VoucherDefinition[]`. `content.ts` exporta `PACKS`, `VOUCHERS` y los incluye en `DEFAULT_CONTENT`.

- [ ] **Step 1: Write the failing tests** in `content.test.ts`, bloques `describe('packs content')` y `describe('vouchers content')`:
  - `PACKS` tiene 3 entradas con los ids y costos de Global Constraints; ids únicos; `size >= picks >= 1`; `kind` ∈ `joker|consumable|card`.
  - `VOUCHERS` tiene 6 entradas con los ids y costos de Global Constraints; ids únicos; cada voucher tiene al menos un modificador y `delta !== 0`; las claves de los modificadores están en `ModifiableConfigKey`.
  - `DEFAULT_CONTENT.packs === PACKS` y `DEFAULT_CONTENT.vouchers === VOUCHERS`.
- [ ] **Step 2: Run** `pnpm --filter @naipes/engine exec vitest run src/roguelike/content.test.ts` → FAIL (PACKS/VOUCHERS no existen).
- [ ] **Step 3: Implement** los tipos en `types.ts` y `PACKS`/`VOUCHERS` en `content.ts` (con el estilo de comentarios de los consumibles: nombre es-419 propuesto y efecto); añadir `packs`/`vouchers` a `DEFAULT_CONTENT` y exportarlos en `index.ts`. Corregir los sitios que construyen un `RunContent` a mano (`grep -rn "RunContent = {" packages apps`): deben heredar de `DEFAULT_CONTENT` o recibir `packs: []`, `vouchers: []`.
- [ ] **Step 4: Run** `pnpm --filter @naipes/engine exec vitest run` y `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(engine): pack and voucher content as data`

---

### Task 2: Estado, versión 3 y ofertas de sobres y vales

**Files:**
- Modify: `packages/engine/src/roguelike/run.ts`, `apps/mobile/src/components/roguelike/ShopScreen.tsx` (solo para que compile)
- Test: `packages/engine/src/roguelike/run.test.ts`

**Interfaces:**
- Consumes: `PackDefinition`, `VoucherDefinition`, `PackItem`, `RunContent.packs/vouchers` (Task 1).
- Produces en `run.ts`:
  - `RunConfig` gana `shopPackOffers: number` (default 2) y `shopVoucherOffers: number` (default 1).
  - `RUN_STATE_VERSION = 3`.
  - `ShopOffer` gana `{ kind: 'pack'; packId: string; price: number; sold: boolean }` y `{ kind: 'voucher'; voucherId: string; price: number; sold: boolean }`.
  - `RunState` gana `vouchers: readonly string[]`, `openPack: OpenPack | null` y `rng.pack: SeededRngState`, con
    `interface OpenPack { readonly packId: string; readonly items: readonly (PackItem & { readonly taken: boolean })[]; readonly picksLeft: number }` (exportado).
  - `openShop` deja `run.shop` = ofertas de comodín + consumible (como hoy) + `shopPackOffers` sobres distintos + `shopVoucherOffers` vales no comprados, sorteados de `rng.pack` (sobres primero, luego vales; si el catálogo tiene menos, se ofrecen los que haya).
  - `reroll` conserva las ofertas `pack` y `voucher` (con su `sold`) y solo sustituye las de comodín y consumible; las nuevas quedan delante, en el mismo orden.

- [ ] **Step 1: Write the failing tests** en `run.test.ts`, `describe('packs and vouchers in the shop')`:
  - `shop layout`: con la semilla `'shop'`, `state.shop.map(o => o.kind)` es `['joker','joker','consumable','consumable','pack','pack','voucher']`; los dos sobres tienen `packId` distintos; el precio de cada oferta es el `cost` de su definición.
  - `jokers and consumables are unchanged`: `state.shop.slice(0, 4)` es idéntico al de la misma semilla antes del cambio (fijar los 4 ids resultantes como constantes en el test, calculados una vez con el código actual de la rama 5a antes de editar) y la oferta 0 de la semilla `'E2E-9'` es el comodín `minimalist` con precio 6.
  - `reroll keeps packs and voucher`: tras comprar el vale (usar `act(shop, { type: 'buy', offerIndex: 6 })` cuando la Task 3 exista; en esta task basta comprobar que las ofertas 4–6 son iguales antes y después de `reroll`) y `rng.pack` no cambia con `reroll`.
  - `no voucher left`: con `content` donde `vouchers: []` no hay oferta `voucher`; con `state.vouchers` ya conteniendo los 6 ids (construido con `{ ...state, vouchers: [...] }` antes de abrir la siguiente tienda) tampoco.
  - `version`: `RUN_STATE_VERSION` es 3 y `createRun('x').state` tiene `vouchers: []`, `openPack: null` y `rng.pack`.
  - Actualizar los tests existentes que cuentan ofertas de la tienda (4 → 7) o comparan `shopOpened.offers`.
- [ ] **Step 2: Run** `pnpm --filter @naipes/engine exec vitest run src/roguelike/run.test.ts` → FAIL.
- [ ] **Step 3: Implement** en `run.ts`: campos y defaults de config; `createRun` inicializa `rng.pack` con `SeededRng.fromSeed(seed, 'pack')`, `vouchers: []`, `openPack: null`; `toDraft` copia `vouchers`; nueva `rollLootOffers(d, content): ShopOffer[]` (sobres distintos y luego vales no comprados, siempre desde `rng.pack`); `openShop` hace `[...rollOffers(...), ...rollLootOffers(...)]`; `reroll` hace `[...rollOffers(...), ...d.shop.filter(o => o.kind === 'pack' || o.kind === 'voucher')]`. En `ShopScreen.tsx`, restringir el tipo de `OfferCard` a las ofertas `joker | consumable` y no pintar aún sobres ni vales (la pantalla nueva es de la Task 8): solo lo necesario para que `pnpm typecheck` pase y el flujo Maestro siga igual.
- [ ] **Step 4: Run** `pnpm --filter @naipes/engine exec vitest run`, `pnpm --filter @naipes/mobile test` y `pnpm typecheck` → PASS (los tests de mobile que guardaban una run versión 2 deben actualizarse a la versión nueva).
- [ ] **Step 5: Commit** `feat(engine): packs and vouchers in the shop offers (state version 3)`

---

### Task 3: Comprar un vale

**Files:**
- Modify: `packages/engine/src/roguelike/run.ts`
- Test: `packages/engine/src/roguelike/run.test.ts`

**Interfaces:**
- Consumes: `ShopOffer` kind `voucher`, `VoucherDefinition`, `RunState.vouchers` (Task 2).
- Produces: `buy` sobre una oferta `voucher` cobra el precio, marca la oferta `sold`, agrega el id a `state.vouchers`, aplica cada modificador a `state.config` creando un objeto nuevo (nunca mutar la config compartida; el valor resultante es `Math.max(0, valor + delta)`) y emite `{ type: 'voucherBought'; voucherId: string }` además de `bought`. Para la clave `rerollBaseCost` también ajusta `state.rerollCost` (`Math.max(0, rerollCost + delta)`). Mismos errores que `buy` (`INVALID_OFFER`, `NOT_ENOUGH_MONEY`).

- [ ] **Step 1: Write the failing tests** (`describe('vouchers')`), con `startingMoney: 50` y la oferta de vale en la posición 6:
  - `extra_hand`: tras comprarlo, `state.config.hands` es 5 y `handsLeft` de la ciega actual no cambia; al llegar a la siguiente ciega (`leaveShop`) `handsLeft` es 5. Igual para `extra_discard` con `discardsLeft`/`discards`.
  - `joker_slot` y `consumable_slot`: `config.jokerSlots` 6 / `config.consumableSlots` 3 y se puede comprar un sexto comodín / tercer consumible.
  - `interest_cap`: `config.interestCap` 5; con $25+ al terminar la ronda el interés es $5.
  - `cheap_reroll`: `config.rerollBaseCost` 2 y el `rerollCost` vigente baja 1; con un `content` de vale `{ key: 'rerollBaseCost', delta: -99 }` el costo queda en 0, no negativo.
  - cobra el precio exacto y marca `sold`; con dinero insuficiente → `NOT_ENOUGH_MONEY` y el estado no cambia; comprar dos veces la misma oferta → `INVALID_OFFER`.
  - `state.config` anterior no se muta (`deepFreeze` ya lo detecta) y `replayRun` de `{ seed, actions: [...buy vale] }` produce el mismo estado final.
  - la tienda siguiente no vuelve a ofrecer un vale ya comprado.
- [ ] **Step 2: Run** `pnpm --filter @naipes/engine exec vitest run src/roguelike/run.test.ts -t vouchers` → FAIL.
- [ ] **Step 3: Implement** `buyVoucher(d, offer, content, events)` llamado desde `buy`, con un único intérprete de modificadores (switch/lookup por `key`, nunca por id de vale).
- [ ] **Step 4: Run** `pnpm --filter @naipes/engine exec vitest run` → PASS.
- [ ] **Step 5: Commit** `feat(engine): buy vouchers that change the run rules`

---

### Task 4: Abrir sobres, elegir y saltar

**Files:**
- Modify: `packages/engine/src/roguelike/run.ts`, `packages/engine/src/index.ts`
- Test: `packages/engine/src/roguelike/run.test.ts`, `packages/engine/src/roguelike/run.property.test.ts`

**Interfaces:**
- Consumes: `OpenPack`, `PackDefinition`, `PackItem`, `rng.pack` (Tasks 1–2).
- Produces:
  - `RunAction` gana `{ type: 'pickFromPack'; itemIndex: number }` y `{ type: 'skipPack' }`.
  - `RunErrorCode` gana `'PACK_OPEN' | 'NO_PACK_OPEN' | 'INVALID_PACK_ITEM'`.
  - `RunEvent` gana `{ type: 'packOpened'; packId: string; items: readonly PackItem[] }`, `{ type: 'packPicked'; itemIndex: number }` y `{ type: 'packSkipped' }`.
  - `buy` sobre una oferta `pack`: rechaza `NO_JOKER_SLOT`/`NO_CONSUMABLE_SLOT` si el sobre es de comodines/consumibles y no hay espacio, y `INVALID_OFFER` si no habría ningún ítem que ofrecer (todo sin cobrar); si no, cobra, marca `sold`, sortea el contenido de `rng.pack` (función `rollPackItems(d, def, content): PackItem[]` con un `switch` exhaustivo sobre `def.kind`: comodines no poseídos y distintos; consumibles distintos; cartas de palo y valor al azar, **siempre con una mejora al azar** de `content.enhancements`) y deja `openPack = { packId, items: items.map(i => ({ ...i, taken: false })), picksLeft: def.picks }`; emite `bought` y `packOpened`.
  - `pickFromPack`: comodín → instancia `j<n>` con el `initialState` de su definición en un espacio libre; consumible → `c<n>` en el inventario; carta → se agrega al final del mazo con id `x<n>` (`nextCardNumber`). Marca el ítem `taken`, baja `picksLeft`, emite `packPicked`; con `picksLeft === 0` pone `openPack = null`. Falla sin cambiar nada con `NO_PACK_OPEN`, `INVALID_PACK_ITEM` (índice fuera de rango o ya tomado), `NO_JOKER_SLOT` o `NO_CONSUMABLE_SLOT`.
  - `skipPack`: `openPack = null`, emite `packSkipped`; `NO_PACK_OPEN` si no hay sobre.
  - Con `openPack !== null`, `buy`, `reroll`, `leaveShop`, `sellJoker`, `applyConsumable`, `sellConsumable` y `moveJoker` devuelven `PACK_OPEN` (comprobación única al inicio de `apply`, antes del `switch`; `abandon` sigue permitido).

- [ ] **Step 1: Write the failing tests** (`describe('packs')`), shop con `startingMoney: 50`, sobres en posiciones 4–5:
  - abrir cada tipo (con `content` que fija el catálogo de sobres para controlar cuál sale en cada posición): `packOpened.items.length === size`; comodines no repetidos ni poseídos; cartas con `enhancement` definido; cobra el precio exacto.
  - determinismo: dos corridas con la misma semilla y acciones abren el mismo contenido; `rng.shop` no cambia al abrir un sobre y `rng.pack` sí.
  - elegir comodín → entra con su `initialState`; consumible → inventario; carta → `deck.length + 1`, id `x1`, mismo `rank/suit/enhancement` que el ítem, y no repite ids; `picksLeft` baja y con 0 el sobre se cierra; en un sobre con `picks: 2` elegir dos ítems distintos funciona y elegir el mismo dos veces → `INVALID_PACK_ITEM`.
  - `skipPack` cierra el sobre sin elegir y también después de una elección parcial.
  - sin espacio: comprar `pack_joker` con 5/5 comodines → `NO_JOKER_SLOT` y `money` intacto; con sobre ya abierto y espacios llenados antes de elegir (estado construido a mano) elegir un comodín → `NO_JOKER_SLOT`, el sobre sigue abierto y nada cambió. Igual con consumibles 2/2.
  - bloqueo: con sobre abierto, cada acción de la lista devuelve `PACK_OPEN` y el estado sigue idéntico; `pickFromPack`/`skipPack` sin sobre → `NO_PACK_OPEN`; índice `-1` o `99` → `INVALID_PACK_ITEM`.
  - catálogo pequeño: con un `content` cuyo único comodín ya se posee, comprar `pack_joker` → `INVALID_OFFER` sin cobrar; con 2 comodines no poseídos y `size: 3` ofrece 2.
  - serialización: `JSON.parse(JSON.stringify(state))` de un estado con sobre abierto sigue siendo aceptado por `runReducer` (`pickFromPack` funciona).
  - `run.property.test.ts`: el generador de acciones incluye `pickFromPack` (índice aleatorio) y `skipPack`; los invariantes existentes se mantienen y se añade: `openPack === null || phase === 'shop'`, `vouchers` sin duplicados, `state.money >= 0` y los ids de cartas del mazo son únicos.
- [ ] **Step 2: Run** `pnpm --filter @naipes/engine exec vitest run src/roguelike` → FAIL.
- [ ] **Step 3: Implement** lo descrito arriba en `run.ts`; exportar `OpenPack` desde `index.ts`. `toDraft` debe copiar `openPack` (los `items` son inmutables: reemplazar el array al marcar `taken`).
- [ ] **Step 4: Run** `pnpm --filter @naipes/engine exec vitest run` y `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(engine): open packs and pick or skip their contents`

---

### Task 5: Simulador con vales y sobre de comodines

**Files:**
- Modify: `packages/engine/scripts/simulate-balance.mjs`

**Interfaces:**
- Consumes: ofertas `voucher`/`pack` y acciones `pickFromPack`/`skipPack` (Tasks 3–4).
- Produces: política en `shop(state, stats)`: tras el bucle actual, (1) compra el vale ofrecido si `state.money - price >= 5`, prefiriendo `extra_hand` y `extra_discard` cuando haya más de uno asequible; (2) compra `pack_joker` si hay espacio de comodín y `state.money - price >= 5`, y si queda sobre abierto elige el primer comodín (con espacio) o salta. Los demás sobres se ignoran. Sin cambios en la política de juego de las ciegas.

- [ ] **Step 1:** Antes de editar, correr `pnpm sim:balance -- --runs 500 --json` y guardar el resultado (línea base 5a: 26/500 victorias, mediana nivel 5).
- [ ] **Step 2: Implement** la política y un contador en el reporte de vales comprados y sobres abiertos.
- [ ] **Step 3: Run** `pnpm sim:balance -- --runs 500 --json` → termina sin lanzar errores (el guard de 2000 pasos no salta) y los vales/sobres comprados son > 0. Registrar el porcentaje de victorias y la mediana en el mensaje del commit. No es una prueba de aprobado/rechazado: el ajuste fino es de la 5f.
- [ ] **Step 4: Commit** `chore(engine): balance simulator buys vouchers and the joker pack`

---

### Task 6: Diseño de la UI (controlador + `disenador-ui-ux`)

**Files:**
- Create: `docs/design/fase5b-sobres-vales-diseno.md`

**Interfaces:** Produce el contrato visual que consumen las Tasks 7–9: la sección Sobres y Vale en la tienda (siete ofertas en 360 px, `testID` `offer-<i>`/`buy-<i>` por posición), la lista de vales comprados (`vouchers-owned`), la hoja del sobre (`pack-sheet`, `pack-item-<i>`, `pack-skip`), estados (sin dinero, sin espacio, ítem ya elegido, error), copia es-419 y accesibilidad (lector de pantalla, texto al 130 %).

- [ ] **Step 1:** Lanzar `disenador-ui-ux` en modo DISEÑAR con el spec de la 5b y `docs/design/fase5a-consumibles-diseno.md` como referencia de estilo (mismos tokens y componentes: `OfferCard`, `Notice`, `ConsumableSheet`, `PlayingCard`, `JokerDetailSheet`).
- [ ] **Step 2:** Revisión del usuario del documento. **Puerta:** las Tasks 7–9 no empiezan sin aprobación (si el usuario delega, el controlador aprueba y lo deja marcado "pendiente de revisión del usuario", como en la 5a).
- [ ] **Step 3: Commit** `docs: phase 5b UI design`

---

### Task 7: Store y textos

**Files:**
- Modify: `apps/mobile/src/game/store.ts`, `apps/mobile/src/i18n/es.ts`
- Test: `apps/mobile/src/__tests__/packs-store.test.ts` (nuevo)

**Interfaces:**
- Consumes: acciones y estado de las Tasks 2–4 de `@naipes/engine`.
- Produces:
  - Store: `pickFromPack(itemIndex: number): RunErrorCode | null` y `skipPack(): void`, con el mismo patrón que `buy` y `sellConsumable` (envuelven `dispatch`; bloqueadas mientras `playback`).
  - `es.ts`: `PACK_TEXTS: Record<string, { name: string; description: string }>` y `VOUCHER_TEXTS` (mismo tipo) con los 3 sobres y 6 vales (nombres originales es-419, definitivos a criterio de quien construya), más `es.shop.packs`, `es.shop.vouchers`, `es.shop.vouchersOwned` y `es.packs` con `title`, `pick(n, left)`, `skip`, `taken`, `errors.noJokerSlot`, `errors.noConsumableSlot`, y `cardItem(rank, suit, enhancement)`.

- [ ] **Step 1: Write the failing tests** (`packs-store.test.ts`): con una run en la tienda y un sobre comprado a través de `useGame.getState().buy(index)`, `run.openPack` existe; `pickFromPack(0)` devuelve `null` y deja el ítem en la run; `pickFromPack(99)` devuelve `'INVALID_PACK_ITEM'`; `skipPack()` deja `openPack === null`; la run guardada con sobre abierto se recupera con `hydrate()` con el sobre abierto (usar el `saveRun`/`loadRun` reales sobre el almacenamiento falso que ya usan los otros tests); cada id de `DEFAULT_CONTENT.packs` y `DEFAULT_CONTENT.vouchers` tiene entrada en `PACK_TEXTS`/`VOUCHER_TEXTS`.
- [ ] **Step 2: Run** `pnpm --filter @naipes/mobile test -- packs-store` → FAIL.
- [ ] **Step 3: Implement** las acciones y los textos.
- [ ] **Step 4: Run** `pnpm --filter @naipes/mobile test` y `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(mobile): store actions and texts for packs and vouchers`

---

### Task 8: La tienda con sobres y vales

**Files:**
- Modify: `apps/mobile/src/components/roguelike/ShopScreen.tsx`
- Test: `apps/mobile/src/__tests__/shop-packs-vouchers.test.tsx` (nuevo)

**Interfaces:**
- Consumes: Task 6 (diseño aprobado), Task 7 (textos y store), ofertas `pack`/`voucher` en `run.shop`.
- Produces: secciones **Sobres** y **Vale** debajo de Consumibles, con `OfferCard` generalizado a las cuatro clases de oferta (mismos `testID` por posición); un sobre cuyo tipo no tiene espacio libre muestra el aviso "sin espacio" y no compra; `vouchers-owned` lista los vales ya comprados (oculta si no hay ninguno); el botón Siguiente ciega y Renovar siguen funcionando igual.

- [ ] **Step 1: Write the failing tests:** con una run en la tienda y dinero 50, se ven las secciones Comodines, Consumibles, Sobres y Vale; `buy-4` abre el sobre (`run.openPack` no nulo); `buy-6` compra el vale, la oferta queda marcada como comprada y `vouchers-owned` lista su nombre; con 5/5 comodines el sobre de comodines muestra el aviso y `buy-<i>` no compra; el texto de cada oferta viene de `PACK_TEXTS`/`VOUCHER_TEXTS`; los `testID` `offer-0` y `buy-0` siguen siendo el primer comodín.
- [ ] **Step 2: Run** `pnpm --filter @naipes/mobile test -- shop-packs-vouchers` → FAIL.
- [ ] **Step 3: Implement** la pantalla siguiendo el diseño aprobado; ningún cálculo de reglas en el componente (los avisos de espacio salen de `run.config` y `run.jokers/consumables`, igual que hoy).
- [ ] **Step 4: Run** `pnpm --filter @naipes/mobile test`, `pnpm lint` y `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(mobile): shop sections for packs and vouchers`

---

### Task 9: Hoja del sobre

**Files:**
- Create: `apps/mobile/src/components/roguelike/PackSheet.tsx`
- Modify: `apps/mobile/src/components/roguelike/ShopScreen.tsx`
- Test: `apps/mobile/src/__tests__/pack-sheet.test.tsx` (nuevo)

**Interfaces:**
- Consumes: `run.openPack`, `useGame` `pickFromPack`/`skipPack`, `PACK_TEXTS`, `JOKER_TEXTS`, `CONSUMABLE_TEXTS`, `PlayingCard` (Tasks 6–8).
- Produces: `PackSheet({ run }: { run: RunState })` visible siempre que `run.openPack !== null` (también al reabrir la app), con `testID` `pack-sheet`, `pack-item-<i>` por ítem y `pack-skip`; muestra "Elige N (quedan M)"; los ítems ya elegidos se muestran marcados y no se pueden tocar; un error de espacio aparece como aviso visible (`Notice`) y la hoja sigue abierta; no se puede cerrar sin elegir o saltar (sin botón de cerrar ni gesto). Montada desde `ShopScreen`.

- [ ] **Step 1: Write the failing tests:** con `run.openPack` de comodines, la hoja se ve y toca `pack-item-0` → el comodín entra en el riel y la hoja se cierra cuando `picksLeft` llega a 0; en un sobre con 2 elecciones, tras la primera el ítem queda marcado y la hoja sigue abierta; `pack-skip` cierra sin elegir; con comodines 5/5 tocar un comodín muestra el aviso de falta de espacio y no cierra; un sobre de cartas muestra cada carta con su marca de mejora y al elegir una el contador de "Mazo" sube en 1; una run hidratada con `openPack` muestra la hoja al montar la tienda; `accessibilityLabel` de cada ítem incluye nombre y descripción.
- [ ] **Step 2: Run** `pnpm --filter @naipes/mobile test -- pack-sheet` → FAIL.
- [ ] **Step 3: Implement** `PackSheet` reutilizando `PlayingCard`, `EnhancementBadge` y las hojas/estilos de la 5a, y montarla en `ShopScreen`.
- [ ] **Step 4: Run** `pnpm --filter @naipes/mobile test`, `pnpm lint` y `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(mobile): pack opening sheet`

---

### Task 10: Cierre, verificación y documentación

**Files:**
- Create: `docs/superpowers/specs/2026-11-27-fase5b-sobres-vales-prueba.md`
- Modify: `CLAUDE.md` (Estado actual), memoria del proyecto (`fase0-estado.md`)

- [ ] **Step 1:** Escribir el checklist manual para el Galaxy A56: tienda con siete ofertas a 360 px y a texto al 130 %; comprar y abrir cada tipo de sobre; elegir 1, saltar; cerrar la app con un sobre abierto y reabrir; sobre de comodines con 5/5; comprar cada vale y comprobar su efecto (mano/descarte en la siguiente ciega, espacios, renovar, interés); renovar conserva sobres y vale; flujo Maestro `roguelike-first-blind` sin cambios (semilla `E2E-9`, `buy-0`).
- [ ] **Step 2:** Verificación en un **checkout limpio** (la lección del CI de la 5a): `git worktree add` de HEAD en una ruta corta, `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (los tests de integración del server pueden fallar solo por rutas largas de Windows; no son de esta fase). Resultado esperado: lint, typecheck, engine, shared, server unit/e2e y mobile en verde.
- [ ] **Step 3:** Actualizar `CLAUDE.md` ("Hecho (pendiente de prueba en dispositivo): Fase 5b…", resultado del simulador, "Siguiente") y la memoria; recordar que la rama está apilada sobre la 5a (mergearla trae también la 4a, la 4c y la 5a si aún no se mergearon).
- [ ] **Step 4: Commit** `docs: close phase 5b`

---

## Self-Review

- **Cobertura del spec:** §5.1 tipos/estado/ofertas (Tasks 1–2), vales (3), sobres y bloqueo (4), renovar (2), contenido inicial (1, Global Constraints), simulador §5.3 (5), §5.2 app y diseño previo (6–9), §6 pruebas (en cada task + Task 10 verificación y Maestro), §2 no-metas respetadas (sin etiquetas, ediciones, mega, venta). Cada decisión marcada **[mi decisión]** del spec tiene su prueba: renovar conserva (T2), carta nueva mejorada (T4), sobre lleno rechazado (T4), vales como config (T3).
- **Consistencia de tipos:** `OpenPack`, `PackItem`, `ModifiableConfigKey`, `shopPackOffers`/`shopVoucherOffers`, `pickFromPack { itemIndex }`, `skipPack`, `PACK_OPEN`/`NO_PACK_OPEN`/`INVALID_PACK_ITEM`, eventos `voucherBought`/`packOpened`/`packPicked`/`packSkipped` se usan con los mismos nombres en todas las tasks.
- **Orden:** la Task 2 deja `mobile` compilando (OfferCard restringido) antes de que exista la UI; las Tasks 1–5 son de motor y no dependen del diseño; 7–9 esperan la Task 6.
- **Riesgo conocido:** los tests existentes que cuentan ofertas de la tienda (4 → 7) o usan guardados versión 2 se actualizan en la Task 2; el test de "comodines y consumibles sin cambios" fija constantes calculadas con la rama 5a **antes** de editar `run.ts`.
