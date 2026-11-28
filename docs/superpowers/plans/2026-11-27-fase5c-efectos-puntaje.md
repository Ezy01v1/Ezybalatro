# Fase 5c — Efectos de carta y puntaje Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir al puntaje del roguelike azar reproducible (`roll`), repeticiones de cartas, ediciones de comodín y el contenido que los usa, con su presentación en la app.

**Architecture:** `scoreHand` gana un RNG opcional (sub-stream `score` en `RunState.rng`), un gancho opcional `retriggers` (tope duro) y la aplicación de la edición de cada comodín; todo lo demás es contenido como datos en `content.ts`. La tienda tira la edición de cada oferta de comodín **después** de todas las demás tiradas de `shop`. La app solo etiqueta los pasos nuevos y marca las ediciones.

**Tech Stack:** TypeScript strict, Vitest + fast-check (`packages/engine`), Jest + RNTL (`apps/mobile`), Expo/RN.

**Spec:** `docs/superpowers/specs/2026-11-27-fase5c-efectos-puntaje-design.md` · ADR `docs/decisions/0010-puntaje-repeticiones-azar-ediciones.md`

## Global Constraints
- El engine es puro y determinista: sin `Math.random`, reloj ni red. Misma semilla + mismas acciones = mismo `RunState` y mismos `steps` (`replayRun`).
- Contenido nuevo = entradas en `packages/engine/src/roguelike/content.ts`; **prohibido** `if` por id en `scoring.ts` o `run.ts`.
- `RUN_STATE_VERSION` pasa de 3 a 4; las runs guardadas viejas se descartan (`loadRun` ya lo hace).
- Repeticiones: solo cartas que puntúan, tope duro `MAX_RETRIGGERS = 3` extra por carta (4 veces en total); una repetición no genera repeticiones.
- Ediciones: `foil` +50 fichas (sobreprecio 2), `holo` +10 mult (3), `poly` ×1.5 mult (4), `ample` +1 espacio de comodín (4). Cada oferta de comodín de la tienda trae edición con probabilidad `1 / config.editionOneIn` (`editionOneIn: 8`; `0` la desactiva). Los comodines de sobre no traen edición.
- Precio de una oferta con edición = costo del comodín + sobreprecio. Valor de venta = `max(1, floor((costo + sobreprecio) / 2))`.
- `roll(n, d)`: `false` si `n <= 0` o `d <= 0` o no hay RNG; `true` sin consumir RNG si `n >= d`; si no, `nextInt(rng, d) < n`.
- Los pasos de `ScoreStep` ganan `repeat` **solo cuando es mayor que 0** (los pasos de la primera vez no cambian de forma). Una tirada fallida no genera paso.
- Textos de UI solo en `apps/mobile/src/i18n/es.ts` (es-419). 360 px de ancho; el texto de un rótulo nunca depende solo del color.
- Commits Conventional, en inglés, sin líneas de atribución. Añadir archivos por ruta (nunca `git add apps` ni `git add .`: hay carpetas sin seguimiento en `apps/server`).
- Verificación por tarea: `pnpm --filter @naipes/engine exec vitest run <archivo>` (engine) y `pnpm --filter @naipes/mobile exec jest <patrón>` (app). Al cerrar cada tarea del engine: `pnpm test:engine`; de la app: `pnpm test:mobile`.

## Decisiones tomadas al planear (rulings; desvían del documento de diseño)
1. La edición se tira **al final de `rollOffers`** (después de todas las tiradas de jokers y consumibles de esa visita), no "después de elegir cada comodín": así las 4 primeras ofertas de una visita no cambian por las ediciones.
2. El 12 % del diseño se implementa como `editionOneIn: 8` (12,5 %) en la config.
3. Las tiradas falladas no generan paso (el diseño decía "se anotan"); solo se ve lo que ocurre.
4. "Chispa" (el tercer comodín de suerte, ambiguo en el diseño): `roll(1, 3)` por carta que puntúa → +3 mult.
5. Con contenido nuevo cambia la oferta 0 de la semilla `E2E-9`; la prueba que la fijaba se reescribe y `find-e2e-seed.mjs` pasa a exigir también una oferta 0 comprable (Maestro solo necesita `buy-0` → `joker-j1`).

## Review Focus
1. Las 4 primeras ofertas de la tienda no cambian por activar las ediciones (misma semilla, `editionOneIn: 8` vs `0`) — Task 3.
2. Una carta que se repite con mejora + comodín `onCardScored` a la vez, y el tope con 5 fuentes de repetición — Task 2.
3. `roll` con `n <= 0`, `d <= 0`, `n >= d` y sin RNG — Task 1.
4. Vender un comodín con edición; `ample` con la tienda a tope y vender el comodín `ample` — Task 3.
5. Cargar una run versión 3 se descarta con el aviso de siempre — Task 1 (prueba móvil existente).

---

### Task 1: Azar en el puntaje (`roll`) y stream `score`

**Files:**
- Modify: `packages/engine/src/roguelike/types.ts` (`HandContext`), `packages/engine/src/roguelike/scoring.ts` (`ScoreInput`, contexto), `packages/engine/src/roguelike/run.ts` (`RUN_STATE_VERSION`, `RunState.rng`, `Draft.rng`, `createRun`, `play`)
- Test: `packages/engine/src/roguelike/scoring.test.ts`, `packages/engine/src/roguelike/run.test.ts`

**Interfaces:**
- Produces: `HandContext.roll(n: number, d: number): boolean`; `ScoreInput.rng?: Rng`; `RunState.rng.score: SeededRngState`; `RUN_STATE_VERSION = 4`.

- [ ] **Step 1: Tests (fail first)** en `scoring.test.ts`, `describe('scoreHand: luck')`, con un contenido inyectado cuyo comodín llama `ctx.roll`:
  - `roll(1, 2)` con `SeededRng.fromSeed('x', 'score')` da el mismo resultado y los mismos pasos en dos llamadas con el mismo RNG fresco.
  - Sin `rng` en el input, `roll(1, 2)` siempre es `false` y no lanza.
  - `roll(0, 4)`, `roll(-1, 4)`, `roll(1, 0)` y `roll(1, -2)` son `false` y **no consumen** el RNG (el siguiente `nextUint32()` coincide con el de un RNG fresco).
  - `roll(4, 4)` y `roll(5, 4)` son `true` y tampoco consumen.
  - El orden de las tiradas sigue el orden de evaluación: dos comodines que tiran en `onHandScored` consumen en orden izquierda → derecha (probado comparando con tiradas manuales del mismo RNG).
  En `run.test.ts`, `describe('score stream')`: (a) `createRun(seed).state.rng.score` existe y es distinto de `rng.shop` y `rng.pack`; (b) jugar una mano con contenido sin azar deja `rng.score` igual al inicial y no toca `shop`/`pack`; (c) con contenido inyectado que tira en `onHandScored`, `rng.score` avanza y `replayRun` de un log de 3 acciones vuelve a dar el mismo `state` (`toEqual`); (d) `RUN_STATE_VERSION` es 4.
- [ ] **Step 2: Run** `pnpm --filter @naipes/engine exec vitest run src/roguelike/scoring.test.ts src/roguelike/run.test.ts` → Expected: FAIL (no existe `roll`, `rng.score`).
- [ ] **Step 3: Implement.** `HandContext` gana `roll`; `scoreHand` construye `roll` sobre `input.rng` siguiendo las reglas de Global Constraints (usa `nextInt` de `../rng`); `RunState.rng`/`Draft.rng`/`toDraft`/`createRun` ganan `score: SeededRng.fromSeed(seed, 'score').getState()`; en `play`, crear `new SeededRng(d.rng.score)`, pasarlo como `rng` a `scoreHand` y guardar `d.rng.score = rng.getState()` después. `RUN_STATE_VERSION = 4`.
- [ ] **Step 4: Run** el mismo comando → Expected: PASS. Luego `pnpm test:engine` → todo verde (arreglar aserciones que fijaban la forma de `rng` o la versión).
- [ ] **Step 5: Mobile:** `pnpm --filter @naipes/mobile exec jest game-logic` → Expected: PASS (la prueba "descarta runs de otra versión" usa la constante).
- [ ] **Step 6: Commit** `feat(engine): seeded luck rolls in scoring (score sub-stream, run state v4)`.

### Task 2: Repeticiones de cartas

**Files:**
- Modify: `types.ts` (`JokerDefinition.retriggers?`, `EnhancementDefinition.retriggers?`), `scoring.ts` (`MAX_RETRIGGERS`, `ScoreSource` con `repeat?`, bucle de cartas), `packages/engine/src/index.ts` (exportar `MAX_RETRIGGERS`)
- Test: `scoring.test.ts`

**Interfaces:**
- Produces: `JokerDefinition.retriggers?(self: JokerInstance, ctx: HandContext, card: RunCard): number`; `EnhancementDefinition.retriggers?(card: RunCard, ctx: HandContext): number`; `export const MAX_RETRIGGERS = 3`; `ScoreSource` de tipo `card`, `enhancement` y `joker` (`onCardScored`) con `readonly repeat?: number`.

- [ ] **Step 1: Tests (fail first)** en `describe('scoreHand: retriggers')`, contenido inyectado:
  - Un comodín `retriggers: () => 1` hace que cada carta que puntúa aporte sus fichas dos veces; los pasos de la segunda vez llevan `repeat: 1` y los de la primera **no tienen** la propiedad `repeat`.
  - Orden: para la carta A con mejora `onScored` (+mult) y un comodín `onCardScored`: pasos = fichas, mejora, comodín (repeat ausente), luego fichas, mejora, comodín (repeat 1), y recién entonces la carta B.
  - Tope: cinco fuentes que devuelven 1 cada una (3 comodines + mejora + otro comodín) dan exactamente `1 + MAX_RETRIGGERS` veces las fichas de la carta (4), `repeat` llega a 3.
  - Una carta debilitada (`isDebuffed`) no se repite ni puntúa.
  - Un comodín que repite solo el primer scoring card (`card.id === ctx.scoring[0].id`) deja a las demás una sola vez.
  - Las cartas en mano (`held`) nunca se repiten aunque `retriggers` devuelva 5.
  - `retriggers` que devuelve negativo, `NaN` o fracción se trata como 0 (`Math.max(0, Math.floor(n))`, `NaN` → 0).
- [ ] **Step 2: Run** `pnpm --filter @naipes/engine exec vitest run src/roguelike/scoring.test.ts` → Expected: FAIL.
- [ ] **Step 3: Implement** en el bucle de `scoringCards`: calcular `extra = min(MAX_RETRIGGERS, suma de retriggers de cada comodín (en orden) + la de la mejora)` una vez antes de puntuar la carta; ejecutar el bloque (fichas → mejora → `runJokers('onCardScored', card)`) `1 + extra` veces pasando `repeat` (solo si > 0) a `apply` y a `runJokers`. No cambiar el orden de lo existente.
- [ ] **Step 4: Run** `pnpm test:engine` → PASS.
- [ ] **Step 5: Commit** `feat(engine): card retriggers in scoring with a hard cap`.

### Task 3: Ediciones de comodín (motor, tienda, espacios, venta)

**Files:**
- Modify: `types.ts` (`EditionDefinition`, `RunContent.editions`, `JokerInstance.edition?`), `content.ts` (`EDITIONS`, `DEFAULT_CONTENT.editions`), `scoring.ts` (aplicar edición), `run.ts` (`RunConfig.editionOneIn`, `ShopOffer` joker con `edition?`, `rollOffers`, `buy`, `jokerSellValue`, `jokerSlotsFor`, comprobaciones de espacio), `index.ts` (exportar `EDITIONS`, `EditionDefinition`, `jokerSlotsFor`)
- Test: `scoring.test.ts`, `run.test.ts`, `content.test.ts`

**Interfaces:**
- Produces: `interface EditionDefinition { readonly id: string; readonly cost: number; readonly effect?: Effect; readonly extraJokerSlots?: number }`; `RunContent.editions: readonly EditionDefinition[]`; `JokerInstance.edition?: string`; `RunConfig.editionOneIn: number` (8 por defecto); `ShopOffer` `joker` con `readonly edition?: string` (y `price` ya incluye el sobreprecio); `export function jokerSlotsFor(state: Pick<RunState, 'config' | 'jokers'>, content?: RunContent): number`; `ScoreSource` `joker` con `hook` ampliado a `'edition'`.

- [ ] **Step 1: Tests (fail first).**
  `scoring.test.ts` (`describe('scoreHand: joker editions')`): un comodín con edición `foil` suma +50 fichas **una vez por mano** con paso `hook: 'edition'` justo después de su propio efecto `onHandScored`; sin gancho `onHandScored` igual aplica la edición; con dos comodines con edición, el orden de pasos es izquierda → derecha, cada uno (suyo, edición) antes del siguiente; `poly` multiplica; `ample` no añade paso.
  `run.test.ts` (`describe('joker editions')`, con `EASY` y `startingMoney: 99`): (a) con `editionOneIn: 8` y con `editionOneIn: 0` la misma semilla da los **mismos `id` en las 4 primeras ofertas** en 20 semillas (Review Focus 1); (b) existe alguna semilla de 200 con una oferta de comodín con edición, y su `price` = costo + sobreprecio de la edición; (c) comprar esa oferta deja `jokers[i].edition` igual a la de la oferta; (d) `jokerSellValue` de un comodín con edición = `max(1, floor((costo + sobreprecio) / 2))`; (e) `reroll` vuelve a tirar ediciones (aparece alguna edición en algún reroll de 200 semillas) y sigue siendo determinista (`replayRun`); (f) los comodines de un sobre no traen edición (`pickFromPack` crea la instancia sin `edition`); (g) `ample`: con 5/5 comodines y uno `ample` entre ellos hay capacidad 6 y se puede comprar un 6.º; vender el `ample` con 6/6 deja 5/5 sin error y sin exceso; `jokerSlotsFor` suma `extraJokerSlots` de los comodines en el riel (con contenido inyectado que fuerce la edición `ample` en un comodín para no depender del azar de la semilla).
  `content.test.ts`: `EDITIONS` tiene 4 ids únicos, costos enteros > 0, y cada edición tiene `effect` o `extraJokerSlots`.
- [ ] **Step 2: Run** `pnpm --filter @naipes/engine exec vitest run src/roguelike` → Expected: FAIL.
- [ ] **Step 3: Implement.** `EDITIONS` según Global Constraints. `scoring.ts`: en `runJokers('onHandScored')` aplicar después del efecto propio de cada comodín el `effect` de su edición con `source = { kind: 'joker', instanceId, jokerId, hook: 'edition' }` (una función que lo haga por cada comodín en orden, también si no define `onHandScored`). `run.ts`: `rollOffers` termina con un bucle sobre las ofertas de comodín **ya sorteadas**: si `config.editionOneIn > 0 && content.editions.length > 0` y `nextInt(rng, editionOneIn) === 0`, tira `nextInt(rng, content.editions.length)`, guarda `edition` y suma `cost` al `price`; el estado de `rng.shop` se guarda al final. `buy` copia `edition` a la instancia; `jokerSellValue(joker, content)` suma el sobreprecio de `joker.edition`; `jokerSlotsFor` y su uso en `buy` (comodín y sobre de comodín) y en `pickFromPack`; añadir `editionOneIn: 8` a `DEFAULT_RUN_CONFIG` y `content.editions` donde se arma `DEFAULT_CONTENT`. Ajustar las pruebas existentes que fijaban precios exactos de ofertas de comodín usando `editionOneIn: 0` en su config (no cambiar su intención).
- [ ] **Step 4: Run** `pnpm test:engine` → PASS; `pnpm typecheck` → sin errores (la app consume `ShopOffer`).
- [ ] **Step 5: Commit** `feat(engine): joker editions (foil, holo, poly, ample) rolled in the shop`.

### Task 4: Contenido nuevo: comodines de repetición y de suerte, mejora "Moneda"

**Files:**
- Modify: `content.ts` (7 comodines + 1 mejora), `run.test.ts` (prueba de la oferta de `E2E-9`), `packages/engine/scripts/find-e2e-seed.mjs`, `apps/mobile/.maestro/roguelike-first-blind.yaml` (solo si cambia la semilla)
- Test: `content.test.ts`, `scoring.test.ts` o `content.scoring.test.ts` (nuevo, mismo directorio)

**Interfaces:** consume `retriggers`, `ctx.roll`, `MAX_RETRIGGERS` de las Tasks 1–2.

Contenido (todo en `content.ts`, comentario con el nombre es-419 propuesto como el resto):
| id | nombre | rareza / costo | efecto |
|---|---|---|---|
| `court_echo` | Eco de la Corte | uncommon / 7 | `retriggers`: 1 si `card.rank` es 11, 12 o 13 |
| `first_encore` | Primer Bis | uncommon / 6 | `retriggers`: 1 si `card.id === ctx.scoring[0]?.id` |
| `last_encore` | Último Bis | uncommon / 6 | `retriggers`: 1 si es la última carta de `ctx.scoring` |
| `heart_echo` | Eco del Corazón | common / 5 | `retriggers`: 1 si `card.suit === 'h'` |
| `lucky_coin` | Moneda de la Suerte | common / 5 | `onHandScored`: `ctx.roll(1, 4)` → `{ money: 4 }` |
| `loaded_die` | Dado Cargado | uncommon / 7 | `onHandScored`: `ctx.roll(1, 8)` → `{ xMult: 2 }` |
| `spark` | Chispa | common / 4 | `onCardScored`: `ctx.roll(1, 3)` → `{ mult: 3 }` |
| mejora `coin` ("Moneda") | — | — | `onScored`: `ctx.roll(1, 2)` → `{ mult: 20 }` |

- [ ] **Step 1: Tests (fail first).** `content.test.ts`: ids únicos, los 27 comodines tienen `cost > 0`, `ENHANCEMENTS` incluye `coin` (7 mejoras). Archivo nuevo `content.scoring.test.ts` con `DEFAULT_CONTENT`: `court_echo` + mano K-K-9-9-9 (full): las dos K puntúan dos veces (fichas × 2 en pasos de `card`); `first_encore` repite solo la primera carta que puntúa; `heart_echo` repite solo corazones; `loaded_die` con un RNG cuyo primer `nextInt(…, 8)` es 0 (construir con `SeededRng` buscando una semilla que lo cumpla en el propio test) da un paso `xMult: 2`, y con otra semilla que da ≠ 0 no da paso; `lucky_coin` idem con `money`; `spark` se evalúa por carta; `coin` sobre una carta que puntúa: con RNG que acierta suma 20 mult, si no no hay paso; mismos inputs + misma semilla → mismos `steps` (`toEqual`).
- [ ] **Step 2: Run** `pnpm --filter @naipes/engine exec vitest run src/roguelike` → Expected: FAIL.
- [ ] **Step 3: Implement** el contenido de la tabla en `JOKERS` y `ENHANCEMENTS`.
- [ ] **Step 4: Run** → los nuevos pasan; ahora falla la prueba "leaves the joker and consumable draws exactly as before" de `run.test.ts` (el catálogo de comodines cambió). Reescribirla como "keeps the first shop of E2E-9 buyable": primera oferta de `atShop('E2E-9')` es `kind: 'joker'` y `price <= state.money`; conservar la parte de `'shop'` solo como `ids('shop')` de 4 elementos con los tipos `joker, joker, consumable, consumable`.
- [ ] **Step 5: Seed de Maestro.** Extender `find-e2e-seed.mjs`: tras elegir la mejor jugada y ganar la ciega, exigir que la oferta 0 de la tienda sea un comodín con `price <= money`. Compilar (`pnpm build:packages`) y correrlo. Si imprime `E2E-9`, no tocar el yaml; si imprime otra, actualizar en el yaml la semilla, las cartas a tocar y el comentario de cabecera, y en `docs/superpowers/specs/2026-11-27-fase5b-sobres-vales-prueba.md` / `…5a-consumibles-prueba.md` las menciones de `E2E-9`.
- [ ] **Step 6: Run** `pnpm test:engine` → PASS.
- [ ] **Step 7: Commit** `feat(engine): retrigger and luck jokers, coin enhancement`.

### Task 5: Propiedades, simulador y cierre del motor

**Files:**
- Modify: `packages/engine/src/roguelike/run.property.test.ts`, `packages/engine/scripts/simulate-balance.mjs`
- Test: el propio `run.property.test.ts`

- [ ] **Step 1: Tests (fail first)** en `run.property.test.ts`, con el generador de acciones existente y `DEFAULT_CONTENT` completo (ya con azar): (a) para todo log generado, `replayRun(log)` reproduce exactamente `state` y la secuencia de `steps` de cada `handScored` (dos réplicas → `toEqual`); (b) en todo `handScored`, ninguna carta aparece en `steps` con `repeat > MAX_RETRIGGERS` ni más de `1 + MAX_RETRIGGERS` veces en pasos `kind: 'card'`; (c) `jokers.length <= jokerSlotsFor(state)` en todo estado; (d) `rng.shop` y `rng.pack` no cambian en una acción `play` (solo `rng.score` y `rng.deck` pueden cambiar). Contadores de cobertura: que alguna mano generada tuvo repetición y alguna ganó una tirada (si el generador no las alcanza, añadir al generador la compra del comodín de repetición cuando está en oferta).
- [ ] **Step 2: Run** `pnpm --filter @naipes/engine exec vitest run src/roguelike/run.property.test.ts` → Expected: FAIL solo en lo que falte del generador; ajustar el generador (no las propiedades) hasta PASS.
- [ ] **Step 3: Simulador.** En `simulate-balance.mjs` reemplazar `state.config.jokerSlots` por `jokerSlotsFor(state)` (exportada por el `dist`), y añadir al informe: manos con repetición y tiradas acertadas (cuenta de pasos con `repeat` y de pasos de comodines/mejoras de suerte). No cambiar la política del bot.
- [ ] **Step 4: Run** `pnpm build:packages` y `pnpm sim:balance -- --runs 300` → corre sin errores, informa victorias y los contadores nuevos; la misma ejecución con la misma semilla da la misma salida. Anotar el porcentaje en el commit (informativo; el ajuste es de la 5f).
- [ ] **Step 5: Run** `pnpm test:engine`, `pnpm typecheck`, `pnpm lint` → verdes.
- [ ] **Step 6: Commit** `test(engine): determinism and cap properties for the 5c scoring`.

### Task 6: Textos, pasos del escenario y espacios en la app

**Files:**
- Modify: `apps/mobile/src/i18n/es.ts` (`JOKER_TEXTS` +7, `ENHANCEMENT_TEXTS.coin`, nuevo `EDITION_TEXTS`, `es.score.again`), `apps/mobile/src/game/playback.ts`, `apps/mobile/src/components/roguelike/GameScreen.tsx` y `ShopScreen.tsx` (usar `jokerSlotsFor`)
- Test: `apps/mobile/src/__tests__/` (`playback.test.ts` existente o nuevo `playback-5c.test.ts`, `edition-texts.test.ts`, y la prueba de textos de contenido existente)

**Interfaces:**
- Produces: `EDITION_TEXTS: Record<string, { name: string; short: string; description: string }>` con `foil` Lámina («+50 fichas»), `holo` Aura («+10 mult»), `poly` Iridiscente («×1,5 mult»), `ample` Amplio («+1 espacio de comodín»), `short` de ≤ 6 caracteres; `PlaybackStep.repeat?: number`.

- [ ] **Step 1: Tests (fail first):** (a) cada id de `JOKERS`, `ENHANCEMENTS` y `EDITIONS` de `DEFAULT_CONTENT` tiene texto con `name`, `short` y `description` no vacíos (ampliar la prueba existente de textos si ya cubre jokers; si no, nueva); (b) `buildPlayback` con un paso de carta con `repeat: 1` da `label` que empieza por `↻ ` y conserva su `tone` y `cardId`; un paso con `hook: 'edition'` lleva `instanceId`; (c) un paso sin `repeat` no cambia de etiqueta respecto de hoy; (d) con 12 pasos (3 repeticiones de 2 cartas, etc.) `stepMs` queda entre `motion.duration.scoreStepMin` y `scoreStep`; (e) `GameScreen` y `ShopScreen` pasan al riel `jokerSlotsFor(run)` (render con un comodín `ample` forzado en el estado: el riel muestra 6 espacios).
- [ ] **Step 2: Run** `pnpm --filter @naipes/mobile exec jest playback edition-texts` → Expected: FAIL.
- [ ] **Step 3: Implement.** Textos en es-419 de los 7 comodines (nombre de la tabla de Task 4, `short` ≤ 12 caracteres, `description` clara: p. ej. «Repite las figuras que puntúan»), mejora «Moneda» («50 %: +20 mult al puntuar»); `labelFor` antepone `↻ ` (`es.score.again`) cuando `source.repeat > 0`; `PlaybackStep` conserva `repeat`; reemplazar `run.config.jokerSlots` por `jokerSlotsFor(run)` en `GameScreen.tsx:158`, `ShopScreen.tsx:64,117,233`.
- [ ] **Step 4: Run** `pnpm test:mobile`, `pnpm typecheck`, `pnpm lint` → verdes.
- [ ] **Step 5: Commit** `feat(mobile): texts, retrigger labels and edition-aware joker slots`.

### Task 7: Ediciones visibles (riel, detalle, tienda)

**Files:**
- Modify: `apps/mobile/src/components/roguelike/JokerRail.tsx`, `JokerDetailSheet.tsx`, `OfferRow.tsx`, `ShopScreen.tsx` (fila de oferta de comodín y precio de venta), `apps/mobile/src/theme/tokens.ts` si hace falta, `i18n/es.ts` (`es.editions`: etiquetas de accesibilidad)
- Test: `apps/mobile/src/__tests__/joker-editions.test.tsx`

Diseño (decidido aquí, sin pantalla nueva): un comodín con edición muestra en la esquina superior del espacio del riel un rótulo con `EDITION_TEXTS[id].short` (texto siempre visible, no solo color) y el borde del espacio toma un acento por edición usando colores existentes (`foil` → `colors.chips`, `holo` → `colors.mult`, `poly` → `colors.primary`, `ample` → `colors.money` o el que exista; verificar en `tokens.ts`); la hoja de detalle añade una línea «Edición: <nombre>. <descripción>»; la fila de oferta de comodín antepone el nombre de la edición a la descripción y su botón de precio ya trae el sobreprecio; la etiqueta de accesibilidad del espacio y de la oferta incluye «edición <nombre>». Nada se corta a 360 px ni con texto al 130 % (rótulo de una línea con `numberOfLines={1}`, `adjustsFontSizeToFit`).

- [ ] **Step 1: Tests (fail first)** en `joker-editions.test.tsx`: (a) el riel con un comodín `edition: 'foil'` muestra el texto `EDITION_TEXTS.foil.short` y su `accessibilityLabel` contiene «Lámina»; sin edición no hay rótulo; (b) `JokerDetailSheet` de un comodín con edición muestra la línea de edición; (c) una oferta de comodín con edición en `ShopScreen` (estado armado con `useGame.setState`) muestra el nombre de la edición y su precio es el de la oferta; (d) vender un comodín con edición muestra en el botón `es.shop.sell(jokerSellValue(...))` con el valor que incluye el sobreprecio; (e) `ample` hace que el riel dibuje un espacio vacío más.
- [ ] **Step 2: Run** `pnpm --filter @naipes/mobile exec jest joker-editions` → Expected: FAIL.
- [ ] **Step 3: Implement** lo descrito arriba (sin cálculos de reglas en la UI: precios y valores salen del motor).
- [ ] **Step 4: Run** `pnpm test:mobile`, `pnpm typecheck`, `pnpm lint` → verdes.
- [ ] **Step 5: Commit** `feat(mobile): joker editions in the rail, detail sheet and shop`.

### Task 8: Documentos de cierre

**Files:**
- Modify: `docs/decisions/0010-puntaje-repeticiones-azar-ediciones.md` (Estado → Aceptado 2026-11-27; precisar: la edición se tira al final de `rollOffers`; las tiradas falladas no generan paso), `docs/superpowers/specs/2026-11-27-fase5c-efectos-puntaje-design.md` (mismas dos precisiones, `editionOneIn: 8`, "Chispa" por carta, Review Focus 1 reformulado), `CLAUDE.md` (estado de la 5c, deuda técnica), `docs/decisions` índice si existe, memoria `fase0-estado.md`
- Create: `docs/superpowers/specs/2026-11-27-fase5c-efectos-puntaje-prueba.md` (checklist del A56)

- [ ] **Step 1: Checklist del A56** (formato de las de 5a/5b): tienda con comodín con edición (rótulo, precio, vender), comodín `ample` abre un espacio, escenario de puntaje con repeticiones (`↻`) y no pasa de ~2,5 s con muchas, comodín de suerte con tirada acertada, mejora «Moneda» en un sobre de cartas, TalkBack lee la edición, texto al 130 %, Maestro (semilla vigente), cargar una run vieja (versión 3) muestra el aviso.
- [ ] **Step 2:** Actualizar los documentos listados; en `CLAUDE.md` el estado dice "Hecho (pendiente de prueba en dispositivo): Fase 5c en la rama … (apilada sobre 5b)", con simulador (% de victorias de Task 5) y deuda técnica (ediciones de carta diferidas a 5d; sin diseño visual formal de las ediciones; vales fuertes sigue pendiente de la 5f).
- [ ] **Step 3: Run** `pnpm lint`, `pnpm typecheck`, `pnpm test` (todo; los de integración del server pueden fallar solo por ruta larga en checkouts limpios de Windows: anotarlo si ocurre) → verdes.
- [ ] **Step 4: Commit** `docs: close phase 5c`.

---

## Self-review
- **Cobertura del diseño:** azar+stream (T1), repeticiones y tope (T2), ediciones con tienda/espacios/venta (T3), contenido 4+3+1 (T4), determinismo/simulador (T5), pasos del escenario y textos (T6), ediciones visibles (T7), docs/prueba (T8). Fuera: ediciones de carta (diferidas por decisión del usuario).
- **Consistencia de tipos:** `roll`, `rng`, `MAX_RETRIGGERS`, `repeat?`, `EditionDefinition`, `editionOneIn`, `jokerSlotsFor`, `EDITION_TEXTS` se nombran igual en todas las tareas.
- **Riesgo conocido:** la tienda reordena `shop` (la edición consume tiradas al final); las pruebas que fijan precios exactos usan `editionOneIn: 0`. Maestro: la oferta 0 de `E2E-9` cambia al ampliar el catálogo (ruling 5).
