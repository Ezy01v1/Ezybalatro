# Fase 5c — Efectos de carta y puntaje (diseño)

Fecha: 2026-11-27 · Estado: **propuesto, pendiente de aprobación del usuario** · Base: [diseño de la Fase 5](2026-11-24-fase5-roguelike-profundidad-design.md) §5c · ADR: [0010](../../decisions/0010-puntaje-repeticiones-azar-ediciones.md)

> El usuario dejó las decisiones a Claude ("toma las mejores decisiones para el proyecto") antes de irse a probar la 5b en el teléfono. Todo lo marcado **[mi decisión]** es una propuesta de Claude. No se escribe código hasta que apruebes este documento y el ADR.

## 1. Intención
Hoy el puntaje es una suma predecible: cada carta y cada comodín actúan una vez. Las tres cosas que hacen que las runs de este género se sientan distintas y a veces "rotas" son repetir cartas, tirar una moneda y comodines con un bono extra propio. La 5c las añade **como datos**, sin tocar el reducer de la run más allá de un stream de RNG nuevo.

**Éxito:** (1) una semilla + acciones da siempre el mismo resultado aunque haya azar en el puntaje; (2) añadir un comodín de repetición o de suerte es una entrada nueva en `content.ts`; (3) el jugador ve en el escenario de puntaje cada repetición y cada tirada; (4) el simulador sigue corriendo y reporta el efecto.

## 2. Metas, no-metas y anti-metas
**Metas:** lo de §1; todo a 360 px y sin red; runs guardadas viejas se descartan limpio (versión 4).
**No-metas:** ediciones de carta (ver ADR, se difiere); repeticiones de cartas en mano; repeticiones de repeticiones; más comodines que los de §4 (eso es 5d); rebalanceo fino (5f).
**Anti-metas:** que el azar rompa `replayRun`; que un comodín de repetición produzca números ilegibles (tope duro); que el escenario de puntaje se vuelva demasiado lento con repeticiones (hay que acotar la duración).

## 3. Restricciones del código (verificadas)
- `scoreHand` (`packages/engine/src/roguelike/scoring.ts`) no recibe RNG y llama cada gancho una vez; el único sitio que lo invoca es `play` en `run.ts` (~línea 466). Los pasos (`ScoreStep`) viajan en el evento `handScored` y los consume `apps/mobile/src/game/playback.ts`.
- `RunState.rng` ya guarda `deck`, `shop`, `boss`, `pack`; un `score` nuevo se añade igual que `pack` en la 5b.
- Hay 6 mejoras de carta (`ENHANCEMENTS`) y 20 comodines con ganchos `onCardScored` / `onCardHeld` / `onHandScored`.

## 4. Enfoques considerados
**A. Ganchos opcionales en datos + RNG en un stream propio (elegido) [mi decisión].** Los efectos nuevos son entradas de contenido; el puntaje gana tres piezas genéricas (`roll`, `retriggers`, ediciones). Costo: una versión de guardado más y un contrato de pasos más rico.
**B. Efectos especiales en el reducer por id ("si es el comodín X…").** Rápido para el primero, pero rompe la regla del proyecto (contenido como datos) y se multiplica. Descartado.
**C. Solo ediciones y repeticiones, sin azar.** Más simple y 100 % analítico, pero quita lo que más sorprende al jugador y deja el ADR a medias. Descartado; el azar entra con un solo contenido de prueba pequeño.

## 5. Diseño [mis decisiones salvo lo indicado]
### Motor
- **Azar:** `ScoreInput.rng?` y `HandContext.roll(n, d)`; stream `score` en `RunState.rng`. Sin `rng`, `roll` es `false`.
- **Repeticiones:** `retriggers?` en comodines y mejoras; solo cartas que puntúan; tope 3 extra por carta; una repetición vuelve a correr fichas → mejora → `onCardScored` de todos los comodines.
- **Ediciones de comodín:** `EditionDefinition` como datos; 4 ediciones: `foil` (+50 fichas), `holo` (+10 mult), `poly` (×1.5), `ample` (+1 espacio de comodín). El efecto se aplica una vez por mano tras el efecto propio del comodín (para que sea legible). Se obtienen en la tienda: cada oferta de comodín tiene 12 % de traer una edición al azar (stream `shop`, tirado **después** de elegir el comodín para no mover lo que ya sale), con sobreprecio por edición y se conserva al comprar/vender (su valor de venta incluye el sobreprecio).
- **Pasos:** `repeat` en `card`/`enhancement`/`joker`; paso nuevo `hook: 'edition'`; los pasos de azar acertado llevan `roll: true`.
- **Versión de guardado:** 4.

### Contenido inicial
- 4 comodines de repetición: repite Reyes/Reinas/Jotas ("Eco de la corte"), repite la primera carta que puntúa, repite la última, repite cartas de un palo.
- 4 de suerte: "+$ con 1 en 4", "×2 con 1 en 8", "+mult aleatorio fijo por mano con tirada" y una mejora de carta "Moneda" (50 %: +20 mult; si no, nada).
- 4 ediciones (arriba).

### Móvil
- `playback.ts`: etiquetas y tono para el paso de repetición ("de nuevo"), de edición y de tirada; las repeticiones aceleran (duración corta por paso) para que una mano con 3 repeticiones no pase de ~2,5 s.
- Riel de comodines: marca de edición (un rótulo corto y un color por edición; no solo color) y su texto en la hoja de detalle.
- Tienda: la oferta de comodín muestra la edición y el precio con sobreprecio. Sin pantallas nuevas.
- Textos en `i18n/es.ts`; diseño visual por `disenador-ui-ux` al empezar la UI (mismo flujo que 5a/5b, aprobación por delegación).

### Simulador
- Reporta, sin cambiar la política del bot, victorias y tiradas; con semilla fija la salida es reproducible.

## 6. Pruebas (guía para el plan)
Propiedades `fast-check`: misma semilla + acciones ⇒ mismo estado final y mismo `steps` (con `rng.score`); el tope de repeticiones nunca se supera; sin `rng`, `roll` siempre `false`. Unitarias: orden de evaluación con repeticiones; edición aplicada una vez; comprar un comodín con edición lo conserva; vender paga el valor correcto; ediciones `ample` suman espacio. Móvil: el escenario muestra los pasos nuevos; el riel marca la edición; accesibilidad del rótulo.

## 7. Review focus (lo que el plan debe cubrir)
1. Semilla fija + `E2E-9` de Maestro: la oferta 0 de la tienda **no** cambia (la edición se tira después y no mueve `shop` antes de la oferta).
2. Una carta con mejora que repite y un comodín `onCardScored` + `retriggers` a la vez.
3. `roll` sin `rng` o con denominador 0 / negativo.
4. Vender un comodín con edición y 5/5 de espacios con `ample`.
5. Cargar una run de la versión 3: se descarta con el aviso de siempre.

## 8. A criterio de quien construya
Nombres definitivos en español (comodines, ediciones, mejora "Moneda"); valores exactos (probabilidades, sobreprecio, bonos) — los ajusta el simulador en 5f; microcopia de los rótulos en el escenario.

## 9. Preguntas abiertas (del usuario)
1. ¿Te parece bien dejar las **ediciones de carta** para después (aquí solo comodines)?
2. ¿Te parece aceptable el **tope de 3 repeticiones** y que las repeticiones solo afecten cartas que puntúan?
3. Las 4 preguntas de la Fase 5 (meta de dificultad, duración de una run, etc.) siguen sin respuesta.
