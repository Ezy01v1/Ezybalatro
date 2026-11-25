# Fase 5a — Consumibles con inventario Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Las "estudios" de la tienda pasan a ser consumibles con inventario de 2 espacios, y aparecen consumibles que modifican las cartas del mazo (mejorar, cambiar palo/valor, destruir, duplicar), usables en la ciega y en la tienda.

**Architecture:** Un tipo de dato `ConsumableDefinition` (lista de operaciones declarativas) y **un** intérprete de operaciones en el reducer de `packages/engine`. La tienda ofrece consumibles en vez de "level up"; comprarlos llena un espacio; usarlos es una acción nueva. La app añade una bandeja de 2 espacios, un modo de "elegir cartas" que reutiliza la selección de la mano y un visor del mazo.

**Tech Stack:** TypeScript strict, Vitest + fast-check (engine), Zustand + jest-expo + RNTL (mobile), Reanimated para la UI existente.

**Spec:** [2026-11-24-fase5-roguelike-profundidad-design.md](../specs/2026-11-24-fase5-roguelike-profundidad-design.md), sección 5a.

## Global Constraints

- Contenido como datos (`content.ts`); el reducer no lleva `if`s por consumible. El motor es puro y determinista: sin reloj, red ni `Math.random`; las acciones se reproducen con `replayRun`.
- Código, nombres, commits y ramas en inglés; textos de UI en es-419 solo en `apps/mobile/src/i18n/es.ts`. Conventional Commits; **sin líneas de atribución** en los commits.
- Rama de trabajo: `feat/phase-5a-consumables`, creada desde `feat/phase-4a-table` hasta que la 4a se mergee (después, desde `main`).
- UI vertical, una mano, 360 px de ancho mínimo, zonas táctiles ≥ 48 px (`touchTarget`), respetar "reducir movimiento".
- Nombres, arte y textos originales (nada copiado de la referencia).
- `RUN_STATE_VERSION` sube a **2**: las runs guardadas viejas se descartan (aceptado en la spec §3).
- `grantMoney` de la spec §5a **queda fuera** de esta subfase (un consumible que da dinero necesita diseño de balance; va a 5f). Los demás: `levelUpHand`, `enhanceCards`, `changeSuit`, `shiftRank`, `destroyCards`, `duplicateCard`.
- La acción se llama `applyConsumable` (no `useConsumable`: el prefijo `use` dispara la regla `react-hooks` del lint al llamarla desde la app).
- El `id` de una carta es su **identidad**, no su cara: tras cambiar palo o valor, `id` no cambia (`"Ks"` puede ser un 5♥). La UI nunca deriva la cara del `id`; los `testID` de tests y Maestro siguen usando el `id`.

## Review Focus

Entradas que la spec no nombra y que más probablemente rompan algo; cada una tiene su test en la tarea indicada.

1. Elegir cartas que no están en la mano, repetidas, de más o de menos, o mandar cartas a un consumible que no las pide → `INVALID_CARDS`, estado intacto (Task 4).
2. Subir una carta a As+1 o bajar un 2 → rechazado sin cambiar nada (Task 4).
3. Destruir cartas hasta dejar el mazo por debajo de `minDeckSize`, o destruir toda la mano → rechazado / la mano se rellena (Task 5).
4. Guardar y cargar (JSON) una run con cartas modificadas y duplicadas; el log reproduce el mismo estado; ids únicos siempre (Task 5).
5. Comprar con los espacios llenos, vender en plena ciega, usar un consumible con cartas en la tienda, comprar con dinero justo (Task 3 y 4).
6. Una run guardada con la versión 1 se descarta sin romper la app (Task 3, test de `loadRun`).

---

## Task 1: Tipos, configuración y mejoras de carta

**Files:**
- Modify: `packages/engine/src/roguelike/types.ts`
- Modify: `packages/engine/src/roguelike/content.ts` (solo `ENHANCEMENTS`)
- Modify: `packages/engine/src/roguelike/scoring.test.ts`
- Test: `packages/engine/src/roguelike/scoring.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type ConsumableOp = { op: 'levelUpHand'; hand: HandCategory } | { op: 'enhanceCards'; enhancement: string } | { op: 'changeSuit'; suit: Suit } | { op: 'shiftRank'; delta: number } | { op: 'destroyCards' } | { op: 'duplicateCard' }` (campos `readonly`).
  - `interface ConsumableDefinition { readonly id: string; readonly cost: number; readonly targets: { readonly min: number; readonly max: number } | null; readonly ops: readonly ConsumableOp[] }`. `targets: null` = no pide cartas (se puede usar en la tienda); si no, solo en la ciega.
  - `interface ConsumableInstance { readonly instanceId: string; readonly consumableId: string }`.
  - `RunContent` gana `readonly consumables: readonly ConsumableDefinition[]`.
- Produces (`content.ts`): `ENHANCEMENTS` con 6 entradas: `reinforced` (ya existe), `anchor` (ya existe) y las nuevas `charged` (al puntuar: `{ mult: 4 }`), `gilded` (al puntuar: `{ money: 2 }`), `heavy` (en mano: `{ chips: 30 }`), `volatile` (al puntuar: `{ xMult: 1.3 }`).

- [ ] **Step 1: Baseline del simulador.** Antes de tocar nada, correr `pnpm build:packages && pnpm sim:balance -- --runs 500 --json` y guardar victorias, nivel mediano y la tabla `deaths` en un archivo del scratchpad. La Task 6 compara contra eso.
- [ ] **Step 2: Escribir los tests de las mejoras nuevas** en `scoring.test.ts`: `charged` suma 4 al multiplicador una vez por carta que puntúa; `gilded` suma $2 a `ScoreResult.money`; `heavy` en una carta que se queda en mano suma 30 fichas y no hace nada si la carta se juega; `volatile` multiplica ×1.3 tras sumar los `+mult`. Cada uno usa una `RunCard` con `enhancement` y comprueba `steps` y `score`.
- [ ] **Step 3: Correr** `pnpm --filter @naipes/engine test -- scoring` → los 4 tests nuevos fallan (mejora desconocida).
- [ ] **Step 4: Añadir los tipos** de arriba a `types.ts` (con `consumables` en `RunContent`) y las 4 mejoras a `ENHANCEMENTS` con comentarios del nombre es-419 propuesto, como el resto del archivo. `DEFAULT_CONTENT.consumables` queda como `CONSUMABLES` en la Task 2: en esta tarea, exportar `CONSUMABLES: readonly ConsumableDefinition[] = []` desde `content.ts` y ponerlo en `DEFAULT_CONTENT` para que compile.
- [ ] **Step 5: Correr** `pnpm --filter @naipes/engine test` y `pnpm typecheck` → todo verde.
- [ ] **Step 6: Commit** `feat(engine): consumable types and four new card enhancements`.

## Task 2: Contenido de consumibles como datos

**Files:**
- Modify: `packages/engine/src/roguelike/content.ts`
- Create: `packages/engine/src/roguelike/content.test.ts`
- Modify: `packages/engine/src/index.ts` (exportar `CONSUMABLES`)

**Interfaces:**
- Produces: `CONSUMABLES: readonly ConsumableDefinition[]` con 21 entradas:
  - 9 estudios generados con `HAND_CATEGORIES.map`: id `study_<categoría>` (p. ej. `study_pair`), `cost: 3`, `targets: null`, `ops: [{ op: 'levelUpHand', hand }]`.
  - Mejoras (`targets: { min: 1, max: 2 }`, `ops: [{ op: 'enhanceCards', enhancement }]`): `reinforce` → `reinforced` ($3), `charge` → `charged` ($4), `gild` → `gilded` ($3), `weigh` → `heavy` ($3), `anchor_card` → `anchor` ($4), `volatilize` → `volatile` ($5).
  - Palos (`targets: { min: 1, max: 3 }`, `ops: [{ op: 'changeSuit', suit }]`, $3): `paint_s`, `paint_h`, `paint_d`, `paint_c`.
  - Otros: `elevate` (`shiftRank` +1, targets 1–2, $3), `scrap` (`destroyCards`, targets 1–2, $2), `twin` (`duplicateCard`, targets 1–1, $4).

- [ ] **Step 1: Escribir `content.test.ts`:** ids únicos; todo `cost >= 1`; todo `targets` tiene `1 <= min <= max <= 5` o es `null`; cada `enhanceCards` apunta a una mejora existente en `ENHANCEMENTS`; los 9 estudios cubren cada `HandCategory` exactamente una vez; toda operación que toca cartas (`enhanceCards`, `changeSuit`, `shiftRank`, `destroyCards`, `duplicateCard`) vive en un consumible con `targets !== null`, y `levelUpHand` en uno con `targets === null`; `duplicateCard` solo con `max === 1`; `DEFAULT_CONTENT.consumables` es `CONSUMABLES`.
- [ ] **Step 2: Correr** `pnpm --filter @naipes/engine test -- content` → falla (lista vacía).
- [ ] **Step 3: Escribir `CONSUMABLES`** con los valores de arriba y los nombres es-419 propuestos en comentarios.
- [ ] **Step 4: Correr** el test → pasa; `pnpm --filter @naipes/engine lint`.
- [ ] **Step 5: Commit** `feat(engine): consumables content as data`.

## Task 3: Inventario, tienda y compra

**Files:**
- Modify: `packages/engine/src/roguelike/run.ts`
- Modify: `packages/engine/src/index.ts` (exportes nuevos)
- Modify: `packages/engine/src/roguelike/run.test.ts`, `run.property.test.ts`
- Modify: `apps/mobile/src/__tests__/game-logic.test.ts` (persistencia)

**Interfaces:**
- Consumes: Task 1 y 2.
- Produces (`run.ts`):
  - `RunConfig`: se **quita** `consumablePrice`; se añaden `consumableSlots: number` (valor `2`) y `minDeckSize: number` (valor `20`). `shopConsumableOffers` se queda en `2`.
  - `RunState`: `consumables: readonly ConsumableInstance[]` (vacío al crear), `nextConsumableNumber: number` (empieza en 1; ids `c1`, `c2`…), `nextCardNumber: number` (empieza en 1; la Task 5 lo usa). `RUN_STATE_VERSION = 2`.
  - `ShopOffer`: se reemplaza `{ kind: 'levelUp'; handType … }` por `{ kind: 'consumable'; consumableId: string; price: number; sold: boolean }`.
  - `RunErrorCode`: añade `'NO_CONSUMABLE_SLOT'` y `'INVALID_CONSUMABLE'`.
  - `RunEvent`: `bought` queda igual.
  - `findConsumable(id: string, content?: RunContent): ConsumableDefinition | undefined` (exportada).
  - `consumableSellValue(instance: ConsumableInstance, content?: RunContent): number` = `max(1, floor(cost / 2))` (exportada).
  - `rollOffers` ofrece `shopJokerOffers` comodines (misma lógica, mismo orden de sorteo que hoy) y después `shopConsumableOffers` consumibles **distintos** del pool de `content.consumables`, con `price = cost`.
  - `buy` de una oferta `consumable` exige espacio (`consumables.length < config.consumableSlots`, si no `NO_CONSUMABLE_SLOT`), añade `{ instanceId: 'c<n>', consumableId }` y descuenta el precio.

- [ ] **Step 1: Tests nuevos/actualizados en `run.test.ts`:** (a) tras ganar la primera ciega, `state.shop.map(o => o.kind)` es `['joker','joker','consumable','consumable']` y los dos consumibles son distintos; (b) comprar un consumible deja `state.consumables` con `[{ instanceId: 'c1', consumableId }]` y descuenta el precio exacto; (c) con `consumableSlots: 1`, la segunda compra falla con `NO_CONSUMABLE_SLOT` y el estado no cambia; (d) con dinero justo (= precio) la compra pasa, con precio − 1 falla con `NOT_ENOUGH_MONEY`; (e) los dos comodines ofrecidos para la semilla `'seed'` son los mismos que antes del cambio (el orden de sorteo no se movió: fijar los ids actuales en el test antes de implementar); (f) `consumableSellValue` redondea hacia abajo con mínimo 1 (coste 3 → 1, coste 5 → 2, coste 1 → 1). Reemplazar el test existente "buy, sell and reorder jokers; level up a hand" quitando la parte de `handLevels`.
- [ ] **Step 2: Test de persistencia** en `game-logic.test.ts`: una run guardada con `version: 1` (`{ ...state, version: 1 }` en el `kv-store`) → `loadRun()` devuelve `{ status: 'corrupt' }` y borra la clave; una run con la versión actual se carga.
- [ ] **Step 3: Actualizar `run.property.test.ts`:** en la rama de la tienda, "asequible" también excluye consumibles cuando `state.consumables.length >= state.config.consumableSlots`; mantener los invariantes que ya comprueba.
- [ ] **Step 4: Correr** `pnpm --filter @naipes/engine test` → fallan los tests nuevos.
- [ ] **Step 5: Implementar** los cambios de `run.ts` descritos arriba (incluye `toDraft`/`createRun` con los campos nuevos, `DEFAULT_RUN_CONFIG`, subir la versión y exportar `findConsumable`/`consumableSellValue` en `index.ts`).
- [ ] **Step 6: Correr** engine (`pnpm --filter @naipes/engine test`) y `pnpm --filter @naipes/mobile test -- game-logic` → verdes. (La app móvil aún no compila contra `levelUp`; se arregla en la Task 9. Mientras tanto, `pnpm typecheck` del móvil puede fallar solo por `ShopScreen`/`es.ts`: no hacer commit de móvil roto, dejar en esta tarea un `kind === 'consumable'` mínimo en `ShopScreen.tsx` que muestre `consumableId` como título y descripción vacía.)
- [ ] **Step 7: Commit** `feat(engine): consumable inventory, shop offers and purchase`.

## Task 4: Aplicar y vender consumibles (nivel, mejora, palo, valor)

**Files:**
- Modify: `packages/engine/src/roguelike/run.ts`, `packages/engine/src/index.ts`
- Test: `packages/engine/src/roguelike/run.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces (`run.ts`):
  - `RunAction` añade `{ type: 'applyConsumable'; instanceId: string; cardIds?: readonly string[] }` y `{ type: 'sellConsumable'; instanceId: string }`.
  - `RunEvent` añade `{ type: 'consumableUsed'; instanceId: string; consumableId: string; cardIds: readonly string[] }` y `{ type: 'consumableSold'; instanceId: string; money: number }`.
  - Reglas de `applyConsumable`: instancia inexistente → `INVALID_CONSUMABLE`; `targets === null` → válido en fase `blind` y `shop`, y `cardIds` ausente o vacío (si trae cartas → `INVALID_CARDS`); `targets !== null` → solo en `blind` (en la tienda `INVALID_PHASE`), con `cardIds` únicos, todos en `hand`, y `min <= cantidad <= max` (si no `INVALID_CARDS`). Un intérprete `applyOp(d, op, targets)` ejecuta las operaciones en orden; `enhanceCards`, `changeSuit` y `shiftRank` reemplazan la carta (nuevo objeto, mismo `id`) en `d.deck` y en `d.hand`; `shiftRank` falla con `INVALID_CARDS` si algún valor sale de 2–14; `levelUpHand` suma 1 a `handLevels[hand]`. Al terminar se quita la instancia del inventario y se emite `consumableUsed`.
  - `sellConsumable`: válido en `blind` y `shop`; suma `consumableSellValue` y emite `consumableSold`; instancia inexistente → `INVALID_CONSUMABLE`.

- [ ] **Step 1: Tests** (todos con `deepFreeze` vía el helper `act`): `study_<categoría>` usado en la tienda sube ese nivel en 1 y libera el espacio; el mismo estudio en la ciega también funciona; `paint_h` sobre 2 cartas de la mano cambia el palo en `hand` **y** en `deck` y deja los `id` iguales; `reinforce` pone `enhancement: 'reinforced'` y esa carta, al jugarse, suma +25 fichas más que antes; `elevate` sobre un 9 da un 10 y sobre un As falla con `INVALID_CARDS` sin cambiar el estado; `shiftRank` con delta −1 sobre un 2 falla (usar un contenido de prueba con ese consumible); cartas no presentes en la mano, repetidas, 0 cartas o más que `max` → `INVALID_CARDS`; mandar cartas a un estudio → `INVALID_CARDS`; consumible con cartas en la tienda → `INVALID_PHASE`; instancia inexistente → `INVALID_CONSUMABLE`; vender en la ciega suma el valor y quita la instancia; vender dos veces la misma → `INVALID_CONSUMABLE`; con la run terminada cualquiera de las dos → `RUN_OVER`.
- [ ] **Step 2: Correr** → fallan.
- [ ] **Step 3: Implementar** `applyConsumable`, `sellConsumable` y `applyOp` en `run.ts` (los casos `destroyCards`/`duplicateCard` del `switch` devuelven `INVALID_CONSUMABLE` hasta la Task 5; el `switch` sobre `op` debe ser exhaustivo).
- [ ] **Step 4: Correr** engine + `pnpm typecheck` (paquetes) → verdes.
- [ ] **Step 5: Commit** `feat(engine): apply and sell consumables`.

## Task 5: Destruir y duplicar cartas; reproducibilidad

**Files:**
- Modify: `packages/engine/src/roguelike/run.ts`
- Test: `packages/engine/src/roguelike/run.test.ts`, `run.property.test.ts`

**Interfaces:**
- Consumes: Task 4.
- Produces: `applyOp` completo.
  - `destroyCards`: quita las cartas de `deck` y `hand`; rechaza con `INVALID_CARDS` si `deck.length − n < config.minDeckSize`; después rellena la mano con `draw`.
  - `duplicateCard`: copia la carta objetivo con `id = 'x' + nextCardNumber++`, la añade al final de `deck` y de `hand` (la mano puede quedar con una carta más que `handSize`; el siguiente `draw` no roba).

- [ ] **Step 1: Tests:** `scrap` sobre 2 cartas deja el mazo en 50, la mano vuelve a `handSize` y las cartas destruidas no están en ningún montón; con `minDeckSize: 51` el mismo `scrap` de 2 cartas falla y el estado no cambia; destruir con la mano completa de `maxCardsPerAction` configurado a 8 (usando el contenido de prueba con `targets: {min:1,max:8}`) rellena 8 cartas nuevas; `twin` deja mazo en 53, mano con 9 cartas, la copia con `id` `x1` y mismo rango/palo/mejora que la original, y un segundo `twin` crea `x2`; jugar la copia funciona y la ciega siguiente baraja las 53 cartas; `hasUniqueIds` se mantiene sobre mazo + mano + montón.
- [ ] **Step 2: Property test:** ampliar `randomAction` con `applyConsumable` (cartas al azar de la mano según `targets`, o sin cartas) y `sellConsumable` cuando hay instancias; añadir al test de guardar/cargar (JSON a mitad de run) que `replayRun` del log da el mismo estado final que el estado jugado, con mazos modificados.
- [ ] **Step 3: Correr** → fallan los de destruir/duplicar.
- [ ] **Step 4: Implementar** las dos operaciones.
- [ ] **Step 5: Correr** `pnpm --filter @naipes/engine test` (incluye propiedades) → verdes.
- [ ] **Step 6: Commit** `feat(engine): destroy and duplicate cards with consumables`.

## Task 6: Simulador de balance

**Files:**
- Modify: `packages/engine/scripts/simulate-balance.mjs`

**Interfaces:** Consumes Tasks 3–5; sin cambios de API.

- [ ] **Step 1: Adaptar la tienda del bot:** compra comodines como hoy; compra un consumible `study_<favorito>` si le sobran $5 tras pagarlo y tiene espacio, y lo **usa de inmediato** (`applyConsumable` sin cartas). Ignora los demás consumibles (el bot completo es la Task 5f de la spec).
- [ ] **Step 2: Correr** `pnpm build:packages && pnpm sim:balance -- --runs 500 --json` y comparar con el baseline de la Task 1. **Criterio:** victorias no más de 3 puntos porcentuales por debajo y mismo nivel mediano ±1. Si cae más, subir `shopConsumableOffers` a 3 en `DEFAULT_RUN_CONFIG` (o bajar el coste de los estudios a 2 en `CONSUMABLES`) y repetir; anotar el cambio.
- [ ] **Step 3: Commit** `chore(engine): balance simulation buys and uses study consumables` (más, si hubo ajuste, `fix(engine): rebalance consumable offers` con los números antes/después en el cuerpo).

## Task 7: Diseño de la UI (compuerta de aprobación)

**Files:**
- Create: `docs/design/fase5a-consumibles-diseno.md` (y wireframes HTML en `docs/design/fase5a/` si hacen falta)

- [ ] **Step 1: Diseñar** con el agente `disenador-ui-ux` (modo DISEÑAR): bandeja de 2 espacios en la ciega y en la tienda (dónde va a 360 px, qué muestra cada espacio, estado vacío), hoja de detalle del consumible (nombre, descripción, "Usar", "Vender $n", con confirmación de venta en dos toques como los comodines), **modo elegir cartas** (qué ve el jugador: contador "2/3", botón "Aplicar", "Cancelar", cómo se distingue de jugar/descartar), marca visual de cartas mejoradas en la mano y en el puntaje, visor del mazo (cómo agrupar 52+ cartas en 360 px) y la tarjeta de oferta de consumible en la tienda (espacios llenos). Incluir accesibilidad (etiquetas, lectores de pantalla, reducir movimiento) y los textos es-419.
- [ ] **Step 2: Pedir la aprobación del usuario** sobre el documento. **No empezar las Tasks 8–11 sin ella.** Si el usuario cambia el diseño, ajustar las Tasks 8–10 antes de implementarlas.
- [ ] **Step 3: Commit** `docs: phase 5a consumables UI design`.

## Task 8: Store del juego y textos

**Files:**
- Modify: `apps/mobile/src/game/store.ts`
- Modify: `apps/mobile/src/i18n/es.ts`
- Test: `apps/mobile/src/__tests__/game-logic.test.ts` (o un archivo nuevo `consumables-store.test.ts` junto a él)

**Interfaces:**
- Consumes: Tasks 3–5 (acciones y `findConsumable`).
- Produces (`GameStore`): `targeting: { instanceId: string } | null`; `beginTargeting(instanceId: string): void` (solo si el consumible pide cartas y la fase es `blind`; limpia `selected`); `cancelTargeting(): void`; `applyConsumable(instanceId: string): RunErrorCode | null` (usa `selected` en el orden de la mano si hay `targeting`; limpia `selected`/`targeting`; incrementa `dealCount`); `sellConsumable(instanceId: string): void`. `toggleCard` usa como tope `targets.max` del consumible mientras haya `targeting` y `maxCardsPerAction` si no. `play` y `discard` se ignoran mientras haya `targeting`. `exitRun`/`startRun` limpian `targeting`.
- Produces (`es.ts`): `CONSUMABLE_TEXTS: Record<string, { name: string; description: string }>` con **una entrada por consumible de `CONSUMABLES`** (los 9 estudios con nombre y descripción derivados de `HAND_NAMES`), `ENHANCEMENT_TEXTS: Record<string, { name: string; short: string; description: string }>` con las 6 mejoras, y `es.consumables` con las cadenas de la bandeja, la hoja, el modo elegir cartas ("Elige hasta {n} cartas", "Aplicar", "Cancelar") y el visor del mazo.

- [ ] **Step 1: Tests del store:** iniciar targeting con `paint_h` limita la selección a 3 (la 4.ª devuelve `'limit'`); aplicar con 0 cartas devuelve `INVALID_CARDS` y no cambia la run; aplicar con cartas cambia la run, limpia `selected`/`targeting` y guarda en el `kv-store`; `beginTargeting` de un estudio no hace nada; `cancelTargeting` limpia la selección; vender suma dinero. Test de textos: toda `consumableId` de `CONSUMABLES` y toda mejora de `ENHANCEMENTS` tiene entrada en `CONSUMABLE_TEXTS`/`ENHANCEMENT_TEXTS`.
- [ ] **Step 2: Correr** `pnpm --filter @naipes/mobile test -- game-logic` → fallan.
- [ ] **Step 3: Implementar** store y textos.
- [ ] **Step 4: Correr** tests móviles, lint y typecheck → verdes.
- [ ] **Step 5: Commit** `feat(mobile): consumable actions, targeting mode and texts`.

## Task 9: Bandeja, hoja de consumible y tienda

**Files:**
- Create: `apps/mobile/src/components/roguelike/ConsumableTray.tsx`, `ConsumableSheet.tsx`
- Modify: `apps/mobile/src/components/roguelike/ShopScreen.tsx`, `GameScreen.tsx`, `GameHud.tsx` (barra de acción del modo elegir cartas)
- Test: `apps/mobile/src/__tests__/game-screen.test.tsx`

**Interfaces:**
- Consumes: Task 8 y el diseño aprobado de la Task 7.
- Produces: `ConsumableTray({ run, onPress }: { run: RunState; onPress: (instanceId: string) => void })` con `testID`s `consumable-slot-<n>`; `ConsumableSheet({ run, instanceId, onClose })` con `testID`s `consumable-use`, `consumable-sell`.

- [ ] **Step 1: Tests (`game-screen.test.tsx`):** la tienda muestra las ofertas `consumable` con nombre y descripción de `CONSUMABLE_TEXTS`; comprar llena el espacio 1 de la bandeja; con espacios llenos la oferta muestra el estado "Espacios llenos" y no se puede comprar; en la tienda un estudio muestra "Usar" y sube el nivel (se ve en `HandLevelsSheet`), un consumible de cartas muestra "Usar" desactivado con la razón; en la ciega, tocar "Usar" de `paint_h` entra en modo elegir cartas: el contador sube al elegir, "Aplicar" está desactivado con 0 cartas, aplicar cambia el palo mostrado y sale del modo; "Cancelar" sale sin cambios; vender necesita dos toques; durante la animación de puntaje la bandeja no responde.
- [ ] **Step 2: Correr** → fallan.
- [ ] **Step 3: Implementar** los componentes y su integración según el diseño aprobado (sin lógica de reglas en la UI; todo pasa por el store).
- [ ] **Step 4: Correr** tests, lint, typecheck → verdes.
- [ ] **Step 5: Commit** `feat(mobile): consumable tray, sheet and shop offers`.

## Task 10: Marca de mejoras y visor del mazo

**Files:**
- Modify: `apps/mobile/src/components/shared/PlayingCard.tsx`, `HandFan.tsx`, `ScoringStage.tsx` (si la marca debe verse al puntuar)
- Create: `apps/mobile/src/components/roguelike/DeckSheet.tsx`
- Modify: `GameHud.tsx` (acceso al visor desde la barra de la ciega) y `ShopScreen.tsx`
- Test: `apps/mobile/src/__tests__/game-screen.test.tsx`

**Interfaces:**
- Consumes: Tasks 7 y 8.
- Produces: `PlayingCard` muestra una marca de `ENHANCEMENT_TEXTS[card.enhancement].short` y su `accessibilityLabel` la incluye; `DeckSheet({ visible, run, onClose })` lista el mazo completo agrupado por palo y ordenado por valor, con las cartas mejoradas marcadas y el total de cartas.

- [ ] **Step 1: Tests:** una carta con `enhancement: 'reinforced'` muestra la marca y su etiqueta accesible incluye el nombre; el visor muestra 52 cartas de inicio, 53 tras un `twin`, y las cartas con palo cambiado aparecen bajo el palo nuevo (no por su `id`).
- [ ] **Step 2: Correr** → fallan.
- [ ] **Step 3: Implementar** según el diseño aprobado.
- [ ] **Step 4: Correr** tests, lint y typecheck → verdes.
- [ ] **Step 5: Commit** `feat(mobile): enhancement badge and deck viewer`.

## Task 11: Cierre, e2e y prueba manual

**Files:**
- Modify: `CLAUDE.md` (Estado actual, glosario si cambia algo), `apps/mobile/.maestro/roguelike-first-blind.yaml` (solo si cambió un `testID`)
- Create: `docs/superpowers/specs/<fecha>-fase5a-consumibles-prueba.md` (checklist manual)

- [ ] **Step 1: Verificación completa:** `pnpm lint && pnpm typecheck && pnpm test` desde la raíz → todo verde. Confirmar que la semilla del e2e (`E2E-9`) sigue dando la misma primera mano y que `buy-0` sigue siendo un comodín (`node packages/engine/scripts/find-e2e-seed.mjs` si no).
- [ ] **Step 2: Escribir el checklist manual** para el Galaxy A56: comprar un estudio y usarlo en la tienda; llenar los 2 espacios y ver el aviso; en la ciega, pintar cartas y ver el palo nuevo en la mano y en el visor; destruir cartas y ver el mazo bajar; duplicar y ver 53 cartas; vender un consumible; cerrar la app con cartas modificadas y "Continuar run".
- [ ] **Step 3: Actualizar `CLAUDE.md`** ("Estado actual": 5a implementada y pendiente de prueba; deuda técnica: `grantMoney` diferido, ids de carta ≠ cara).
- [ ] **Step 4: Commit** `docs: close phase 5a`.
