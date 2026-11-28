# Roguelike: lo que tenemos vs. la referencia (Balatro)

Fecha: 2026-11-24 · Estado del código: `packages/engine/src/roguelike/` en la rama `feat/phase-4a-table`.

> Las cifras de la referencia salen de memoria del diseñador del juego, no de una verificación en línea: confírmalas en la wiki oficial antes de fijar números. Solo se toman **mecánicas generales**; nombres, arte, textos y números concretos de comodines son nuestros (CLAUDE.md, "Propiedad intelectual").

## Lo que ya coincide

| Mecánica | Nuestro juego |
|---|---|
| 8 niveles × 3 ciegas (pequeña, grande, jefe) | Igual (`antes: 8`) |
| 4 manos, 3 descartes, mano de 8, 1–5 cartas por jugada | Igual |
| Fichas × Multiplicador, niveles por tipo de mano | Igual (`HAND_TYPES`, `handLevels`) |
| 5 espacios de comodín, el orden importa, vender a la mitad | Igual |
| Dinero inicial $4, recompensa por ciega, $1 por mano sobrante, interés por cada $5 | Igual (tope de interés $4 en vez de $5) |
| Tienda con renovar de costo creciente | Igual |
| Jefe con una regla que estorba (palo o figuras no puntúan, menos manos/descartes/cartas) | 5 jefes |
| Cartas que puntúan vs. que solo se juegan; cartas en mano que activan efectos | Igual (`onCardScored`, `onCardHeld`) |
| Semilla reproducible | Mejor: misma semilla + mismas acciones = mismo resultado, con log y `replayRun` |

## Lo que falta (de más a menos importante para que se sienta una run variada)

| # | Mecánica de la referencia | Nuestro estado | Impacto |
|---|---|---|---|
| 1 | **Consumibles con inventario** (2 espacios): cartas de un solo uso que mejoran tipos de mano o modifican cartas del mazo (mejorar, cambiar palo/valor, duplicar, destruir) | Solo "subir nivel" y se aplica al comprar; sin inventario ni espacios. El pipeline de mejoras de carta existe pero **no hay forma de obtenerlas** | Muy alto: es la mitad de la construcción de mazo |
| 2 | **Sobres** en la tienda (abres uno y eliges 1 de varias cartas: comodines, consumibles, cartas) | No existen | Alto: da elección y emoción al abrir |
| 3 | **Comodines** (150 en la referencia) | 20 | Muy alto: la rejugabilidad depende de esto. Meta razonable: 50–60 antes de publicar |
| 4 | **Ediciones** de comodín/carta (brillante, holográfica, policroma, negativa = +1 espacio) | No existen | Medio-alto |
| 5 | **Mejoras de carta** (≈8) y **sellos** (≈4) | 2 mejoras de muestra, 0 sellos | Alto, va junto con el punto 1 |
| 6 | **Vales** (mejoras permanentes: +1 mano, +1 descarte, +espacio, renovar más barato, más interés) | No existen | Alto: da decisiones económicas de largo plazo |
| 7 | **Saltar ciega** y obtener una **etiqueta** (premio de un solo uso) | No existe | Medio: decisión de riesgo/recompensa |
| 8 | **Jefes** (≈23, más 6 "finales" para el último nivel) | 5, sin jefe final distinto | Medio-alto |
| 9 | **Repeticiones** (retrigger) y comodines que copian a otros | Los hooks se llaman una vez por carta; no hay repeticiones | Medio: habilita sinergias de comodines raros |
| 10 | **Efectos de probabilidad** (cartas/comodines "de suerte") | El scoring es puro y sin RNG | Medio: hay que inyectar un sub-stream del RNG |
| 11 | **Rareza legendaria** y comodines raros más fuertes | Solo común/poco común/raro | Bajo-medio |
| 12 | **Manos secretas** (cinco iguales, casa de color, cinco de color; requieren cartas repetidas) | 9 tipos estándar | Bajo hasta tener cartas duplicadas (punto 1) |
| 13 | **Mazos distintos** al empezar (con ventajas/penalizaciones) | Un solo mazo | Medio |
| 14 | **Dificultades** (apuestas más altas, jefes peores) y **modo infinito** tras ganar | No hay | Medio: sostiene a los jugadores que ya ganaron |
| 15 | Colección/desbloqueos, desafíos, estadísticas | Solo la semilla y el fin de run | Bajo por ahora |

## Equilibrio

- La simulación actual (`pnpm sim:balance`, bot codicioso) da ~8 % de victorias y nivel mediano 5. La referencia es más generosa porque el jugador humano usa consumibles, sobres y vales para construir; sin ellos, el mismo bot no tiene herramientas. Conviene **rehacer el balance** cuando existan los puntos 1, 2 y 6.
- El tope de interés ($4) es más bajo que el de la referencia ($5): decisión de balance, no error.

## Propuesta de siguiente fase (Fase 5: profundidad del roguelike)

Orden sugerido, cada paso jugable por sí solo:

1. **Inventario de consumibles** (2 espacios) + primeras cartas que modifican el mazo; mejoras de carta obtenibles.
2. **Sobres** en la tienda.
3. **Vales** (4–6 al inicio).
4. **Más comodines** (de 20 a ~50) y 4–6 jefes nuevos, con un jefe final en el nivel 8.
5. **Saltar ciega + etiquetas**.
6. **Ediciones**, repeticiones y efectos de probabilidad (requieren tocar el pipeline de scoring: ADR corto).
7. **Rebalanceo** con `pnpm sim:balance`, ahora con un bot que use consumibles.

Cada contenido nuevo va como datos en `content.ts` (regla de CLAUDE.md); solo los puntos 6 y 10 piden cambios de motor.
