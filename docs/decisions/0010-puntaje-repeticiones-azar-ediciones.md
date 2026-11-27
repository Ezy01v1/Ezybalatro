# 0010. Puntaje del roguelike: repeticiones, azar y ediciones
Estado: Propuesto (pendiente de aprobación del usuario)
Fecha: 2026-11-27

## Contexto
`scoreHand` (ADR 0003, Fase 1–2) es una función pura sin RNG: orden fijo (base → cartas que puntúan → cartas en mano → comodines) y cada gancho se llama una vez por carta. La Fase 5c necesita tres cosas que eso no permite: repetir una carta que puntúa, efectos de probabilidad y comodines con "edición" (un bono propio, aparte de su efecto). Todo debe seguir siendo reproducible: misma semilla + mismas acciones = mismo resultado (`replayRun`), y el contenido sigue siendo datos con ganchos puros.

## Decisión
1. **Azar con un sub-stream propio `score`.** `ScoreInput` gana `rng?: Rng`; `HandContext` gana `roll(n: number, d: number): boolean` ("n entre d"), que consume el stream en orden de evaluación. Sin `rng`, `roll` siempre es `false` (los tests puros y el contenido sin azar no cambian). `RunState.rng.score` guarda el estado y `play` lo avanza igual que `shop`/`pack`: no mueve lo que ya sortean los demás streams. El orden de evaluación es el del puntaje (fijo), así que la secuencia de tiradas es determinista.
2. **Repeticiones como gancho opcional.** `JokerDefinition.retriggers?(self, ctx, card): number` y `EnhancementDefinition.retriggers?(card, ctx): number` devuelven cuántas veces extra se repite una carta que puntúa. Solo cartas que puntúan (no las de la mano). Se suman, con **tope duro de 3 repeticiones por carta** (4 veces en total). Una repetición vuelve a ejecutar, en orden: sus fichas, su mejora (`onScored`) y los `onCardScored` de todos los comodines. Los ganchos `retriggers` se evalúan una vez por carta, antes de puntuarla, así que una repetición no puede generar más repeticiones (sin bucles).
3. **Ediciones de comodín como datos.** `JokerInstance.edition?: string` y `EditionDefinition { id, effect?: Effect, extraJokerSlots?: number }` en el contenido. El efecto de la edición se aplica **una vez por mano**, en el momento de `onHandScored` de ese comodín (justo después de su efecto propio, o solo, si no tiene ese gancho), siguiendo el orden de izquierda a derecha, para que los números sean legibles. Una edición con `extraJokerSlots` suma espacios a la config mientras el comodín esté en el riel (se calcula al leer, no se guarda en la config).
4. **Contrato de pasos.** `ScoreSource` gana: `card` con `repeat: number` (0 = la primera vez) y `enhancement` con `repeat`; los comodines con `repeat` en `onCardScored`; y un `joker` con `hook: 'edition'`. La UI y `playback.ts` solo añaden etiquetas; no calculan reglas.
5. **Guardado:** `RUN_STATE_VERSION` pasa a 4 (las runs guardadas viejas se descartan, como en la 5a y la 5b).

## Alternativas descartadas
- **`Math.random` o RNG global en los ganchos:** rompe el engine puro y la reproducibilidad (invariante 5 y 6 de `CLAUDE.md`).
- **Un stream compartido con `shop`:** una tirada de puntaje movería lo que da la tienda; con semillas fijas de Maestro (`E2E-9`) cambiaría cada comodín ofrecido.
- **Repeticiones recursivas (un comodín que repite a otro que repite):** crecimiento sin tope y números ilegibles; el tope duro y la evaluación previa lo evitan.
- **Ediciones de carta en la misma fase:** una carta ya tiene mejora; una segunda ranura obliga a cambiar `RunCard`, el visor del mazo, la tienda y los sobres a la vez. Se difiere (5d o después).

## Consecuencias
- Un comodín de repetición o de suerte es una entrada nueva en `content.ts`; el puntaje no tiene `if` por id.
- El simulador y la propiedad `fast-check` de la run deben cubrir `rng.score` (misma semilla, mismo resultado; el log reproduce el estado final).
- El contenido de azar vuelve el puntaje no analítico: la UI debe mostrar qué tiradas salieron (un paso por tirada acertada; las falladas se anotan en el paso).
- Cambiar el orden de evaluación del puntaje cambia el resultado de las semillas existentes; aceptable antes de publicar.

## Disparador para revisar
- Si un comodín necesita repetir cartas en mano, o repeticiones encadenadas, se revisa el tope y la evaluación previa.
- Si el puntaje se acerca a `Number.MAX_SAFE_INTEGER` en runs tardías, se aplica el plan de la invariante 8 (librería de números grandes).
