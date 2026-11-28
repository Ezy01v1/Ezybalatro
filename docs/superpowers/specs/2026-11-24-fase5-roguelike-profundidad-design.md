# Fase 5 — Profundidad del roguelike (diseño)

Fecha: 2026-11-24 · Estado: **aprobado por el usuario el 2026-11-24** (las 4 preguntas de §7 siguen abiertas; plan de la 5a en `docs/superpowers/plans/2026-11-24-fase5a-consumibles.md`) · Base: [roguelike-vs-referencia.md](../../design/roguelike-vs-referencia.md)

> El usuario dejó las decisiones de enfoque a Claude ("haz lo que crees mejor") y respondió que contestaría las preguntas abiertas después. Todo lo marcado **[mi decisión]** es una propuesta de Claude, no algo que el usuario haya aceptado. Las preguntas que sí son suyas están al final.

## 1. Intención

Hoy una run se resuelve casi sola: 20 comodines, una tienda con 2 comodines y 2 "estudios", y un solo mazo de 52 cartas que nunca cambia. Un bot codicioso gana ~8 % y la mediana llega al nivel 5. Falta lo que hace distinta cada run: **construir el mazo y la mano de comodines con decisiones que importan**.

La fase añade, en este orden de valor: consumibles con inventario, sobres, vales, efectos de carta más ricos (ediciones, repeticiones, azar), más contenido (comodines y jefes), saltar ciega con etiquetas y un rebalanceo continuo.

**Éxito (propuesta, a confirmar):** dos runs con semillas distintas se sienten diferentes; el jugador tiene al menos 2–3 decisiones de construcción por tienda; un bot que use todo lo nuevo gana entre 20 y 35 % de las runs (hoy 8 % sin herramientas).

## 2. Metas, no-metas y anti-metas

**Metas**
- Cada pieza nueva es **contenido como datos** (regla de `CLAUDE.md`); el motor solo gana lo que no se pueda expresar así.
- El motor sigue puro y determinista: misma semilla + mismas acciones = mismo resultado, con `replayRun`.
- Todo funciona sin red y a 360 px de ancho con una mano.
- Cada subfase se puede jugar y probar en el teléfono por sí sola.

**No-metas (Fase 6 o después)**
- Mazos de inicio distintos, dificultades/apuestas, modo infinito, colección y desbloqueos, desafíos diarios.
- Manos secretas (cinco iguales, etc.): necesitan cartas duplicadas; se revisan cuando exista "duplicar carta".
- Nombres, arte, textos o números copiados de la referencia: todo original (`CLAUDE.md`, "Propiedad intelectual").
- Cualquier cambio en el Modo Mesa.

**Anti-metas (fracaso aunque "funcione")**
- Una tienda tan cargada que no se entienda en 360 px.
- Que el azar nuevo rompa la reproducibilidad por semilla.
- Que el contenido nuevo obligue a `if`s repartidos en el reducer.

## 3. Restricciones del código actual (lo que se verificó)

- `scoreHand` aplica un orden fijo (base → cartas que puntúan → cartas en mano → comodines) y **no recibe RNG**; los hooks se llaman una vez por carta. Repeticiones y efectos de probabilidad piden tocarlo (subfase 5c, con un ADR corto).
- `RunState` tiene `version`; cambiar su forma obliga a subir `RUN_STATE_VERSION` y las runs guardadas viejas se descartan (ya existe el mensaje de "run anterior corrupta"). Antes de publicar es aceptable.
- Tienda, jefe y mazo usan **sub-streams de RNG separados** (`deck`, `shop`, `boss`). Se añaden `pack`, `tag` y `score` para no desplazar lo existente. Cambiar el contenido cambia lo que da cada semilla (aceptable antes de publicar; el log de una run vieja no se podrá reproducir con contenido nuevo).
- No hay pantalla de "elegir ciega": `leaveShop` arranca la siguiente ciega. Saltar ciega exige una fase nueva (`blindSelect`).
- El jefe se sortea de toda la lista sin importar el nivel; un jefe final del nivel 8 exige elegir por nivel.
- `ShopOffer` es `joker | levelUp`; el catálogo de acciones (`RunAction`) y de eventos (`RunEvent`) crecen, y `apps/mobile/src/game/store.ts`, `ShopScreen.tsx` y `GameHud.tsx` los consumen.
- `apps/mobile/src/game/playback.ts` reproduce los `steps` del puntaje: toda fuente nueva (edición, repetición) necesita un paso nuevo en ese contrato.

## 4. Enfoques considerados

**A. Rebanadas verticales por función (elegido) [mi decisión].** Cada subfase entrega motor + UI + simulador y se juega en el teléfono. Se puede detener o reordenar entre subfases. Costo: la tienda se reorganiza más de una vez.

**B. Primero todo el motor, luego toda la UI.** Menos retrabajo de pantallas, pero hasta el final no hay nada que probar con las manos y el balance se calibra a ciegas. Riesgo de "big bang". Descartado.

**C. Primero contenido (más comodines y jefes), mecánicas después.** Es lo más barato y da variedad rápida, pero no añade decisiones de construcción: sin consumibles, sobres ni vales, más comodines solo alargan una tienda que ya es de pura suerte. Se hace **dentro** de A (5d), después de las mecánicas que los nuevos comodines necesitan.

## 5. Subfases

Cada subfase termina con: tests del motor (incluida una propiedad `fast-check` de reproducibilidad), pantalla jugable, simulador actualizado, prueba manual en el A56 y su propia spec/plan.

### 5a — Consumibles con inventario
- `consumableSlots: 2` en la config; `consumables: ConsumableInstance[]` en el estado.
- `ConsumableDefinition` como datos: `{ id, cost, targets: { min, max } | null, effect }`, donde `effect` es una lista de operaciones declarativas (`levelUpHand` de un tipo elegido o aleatorio, `enhanceCards`, `changeSuit`, `changeRank`, `destroyCards`, `duplicateCard`, `grantMoney`). El reducer tiene **un** intérprete de operaciones; los consumibles nuevos son datos.
- Acciones: `useConsumable { slot, cardIds? }` y `sellConsumable { slot }`. Se usan en la ciega (objetivos = cartas de la mano) y en la tienda (solo los que no piden cartas) **[mi decisión]**.
- Las mejoras de carta pasan de 2 a ~6 y se pueden conseguir por primera vez. Los "estudios" actuales se convierten en un consumible más (se compran y quedan en el inventario en vez de aplicarse al instante).
- UI: bandeja de 2 espacios en el HUD, selección de objetivos reutilizando la selección de la mano, visor del mazo (lista por palo) para ver qué cartas se modificaron.
- Contenido inicial: ~10 consumibles.

### 5b — Sobres y vales
- La tienda pasa a tener: 2 ofertas de comodín, 2 de consumible, **2 sobres** y **1 vale**.
- Sobre: `PackDefinition { id, cost, kind, size, picks }`; al abrirlo se muestran `size` cartas y se eligen `picks` (tipos: comodines, consumibles, cartas de mazo mejoradas). Acciones `openPack`, `pickFromPack`, `skipPack`; estado `openPack` en `RunState`; stream `pack`.
- Vale: `VoucherDefinition { id, cost, modifiers }` con modificadores numéricos sobre la config (+1 mano, +1 descarte, +1 espacio de comodín, +1 de consumible, renovar más barato, tope de interés +1). Un vale por tienda; no se repiten.
- UI: la tienda se reorganiza en pestañas o secciones desplazables; hoja de apertura de sobre.
- Contenido inicial: 3 sobres, 6 vales.

### 5c — Efectos de carta y puntaje (cambio de motor)
- **ADR corto** antes de tocar nada: ediciones, repeticiones y azar dentro del puntaje.
- Ediciones de comodín y de carta (3 + una que da espacio extra): se guardan en la instancia/carta y suman pasos al puntaje.
- Repeticiones: hook opcional `retriggers` que devuelve cuántas veces repetir una carta que puntúa; límite duro para evitar bucles.
- Azar: `scoreHand` recibe un RNG con sub-stream `score`; los efectos "de suerte" lo usan, así sigue siendo reproducible.
- `ScoreSource` y `playback.ts` ganan los pasos nuevos; el escenario de puntaje de la UI los anima.
- Contenido inicial: ~6 ediciones y efectos de suerte, ~4 comodines que usan repeticiones.

### 5d — Más comodines y jefes (solo datos, más rareza)
- De 20 a ~50 comodines (incluida la rareza legendaria), ~7 jefes más y **jefe final del nivel 8** distinto: `BossDefinition` gana `tier: 'regular' | 'final'` y `pickBoss` elige por nivel.
- Sin cambios de motor salvo lo que 5c haya habilitado. El simulador sirve para detectar comodines rotos (promedio de puntaje por comodín).

### 5e — Saltar ciega y etiquetas
- Fase nueva `blindSelect` entre la tienda y la ciega: se puede jugar o saltar la pequeña y la grande (no el jefe) **[mi decisión]**.
- `TagDefinition` como datos (ej. una renovación gratis, +$ , un sobre gratis, subir nivel de un tipo de mano); acciones `skipBlind`; estado `tags[]`.
- Se muestran las ciegas del nivel con su objetivo, su recompensa y lo que da saltarla.

### 5f — Rebalanceo (continuo; cierre al final)
- El simulador (`simulate-balance.mjs`) aprende a usar consumibles, sobres y vales con una política simple, y se corre al final de cada subfase.
- Al cerrar la fase se ajustan `anteTargets`, recompensas, precios e interés hasta la meta de §1.

## 6. Lo que queda a criterio de quien construya
Nombres definitivos en español de consumibles, sobres, vales, etiquetas y ediciones (originales); valores exactos de costos y recompensas (los fija el simulador); distribución visual de la tienda dentro de los 360 px (la propone `disenador-ui-ux` al empezar 5a/5b, con el mismo flujo de diseño → aprobación → código de la Fase 4).

## 7. Preguntas abiertas (del usuario)

1. **Objetivo:** ¿qué debe sentir o poder hacer un jugador en una hora de roguelike que hoy no puede? Con eso se confirma o cambia el orden de §5.
2. **Meta de dificultad:** ¿20–35 % de victorias para un bot que usa todo te parece bien, o prefieres más difícil/fácil? (La referencia es más generosa porque el humano construye mejor que el bot.)
3. **Tiempo de una run:** ¿cuántos minutos debería durar una run completa de 8 niveles? Si debe caber en una sesión corta, hay que limitar el tamaño de la tienda y de los sobres.
4. **¿Parar a medias?** ¿Aceptas que 5a–5b se prueben y se mergeen antes de seguir (recomendado), o prefieres una sola entrega al final?
