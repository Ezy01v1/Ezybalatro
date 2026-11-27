# Fase 5a — Consumibles con inventario: prueba manual (Galaxy A56)

Fecha: 2026-11-26 · Rama: `feat/phase-5a-consumables`.

Diseño: `docs/superpowers/specs/2026-11-24-fase5-roguelike-profundidad-design.md` · plan: `docs/superpowers/plans/2026-11-24-fase5a-consumibles.md` · UI: `docs/design/fase5a-consumibles-diseno.md` (la evidencia visual de su §12 se marca en los puntos 17 a 20).

Para ver una run con muchos consumibles conviene jugar con semilla (Inicio → "Jugar con semilla") y repetirla; la semilla se ve en el fin de run.

## Prueba manual pendiente (Galaxy A56)

1. Tienda: entre las ofertas hay jokers y consumibles agrupados, con el precio y una línea "Se usa durante una ciega" o "Se usa en la tienda o en una ciega".
2. Comprar un estudio (p. ej. "Estudio: Par") → aparece en la bandeja de consumibles (espacio 1 de 2). Tocarlo → hoja de detalle → "Usar" en la misma tienda → aviso con el nivel nuevo, y en "Niveles de mano" ese tipo de mano sube un nivel.
3. Llenar los 2 espacios (comprar dos consumibles sin usarlos): renovar la tienda ("Renovar $N") hasta que aparezca otra oferta de consumible; en esa tercera oferta el botón queda inactivo con "Espacios llenos". Los jokers siguen comprándose si hay espacio de joker.
4. En una ciega, con una tinta (Tinta de Picas/Corazones/Diamantes/Tréboles): abrir el consumible → "Usar" → modo elegir cartas; elegir 2 o 3 cartas de la mano → "Aplicar". Las cartas cambian de palo en la mano, y en "Ver mazo" aparecen en el palo nuevo (el `id` no cambia pero la cara sí; el conteo por palo cuadra).
5. Modo elegir cartas: con 0 cartas "Aplicar" está inactivo; al elegir la carta de más del máximo aparece "Solo puedes elegir N"; la barra Jugar/Descartar no aparece mientras se eligen.
6. "Ascenso" (`elevate`) sobre un As → mensaje "El As ya no puede subir." y no se gasta el consumible. Sobre un 9 → pasa a 10.
7. "Chatarra" (`scrap`): elegir 1 o 2 cartas → "Aplicar" cambia a "Confirmar: destruir" durante 3 s; el segundo toque destruye. Cambiar la selección o cancelar desarma la confirmación. El contador "Mazo n" baja en la cantidad destruida y el visor muestra 50 o 51 cartas.
   - Caso de mano vacía: tras adelgazar el mazo con varias `scrap`, una `scrap` que te dejaría sin cartas en la mano se rechaza con el mensaje "Te quedarías sin cartas en la mano." y no se gasta el consumible. Descartar las últimas cartas cuando ya no quedan por robar termina la run.
8. "Gemelo" (`twin`) sobre 1 carta: la copia entra en la mano, así que el contador "Mazo n" (cartas por robar) no cambia; el visor del mazo y la etiqueta accesible del botón pasan de 52 a 53, con la copia en su palo.
9. Mejoras de carta (Refuerzo, Carga, Dorado, Lastre, Anclaje, Volatilizar): la carta mejorada muestra una etiqueta; rellena si actúa al puntuar, con contorno si actúa en la mano (la leyenda del visor lo explica). Se ve en la mano, en la etapa de puntaje cuando se juega, y en el visor.
10. Vender un consumible: abrir la hoja → "Vender $N" → cambia a "Confirmar venta $N" (dos toques); paga la mitad del precio (mínimo $1) y el dinero sube. Cerrar la hoja entre toques desarma la venta.
11. Con la mano en pleno conteo de puntaje, y con la ciega ya superada, la bandeja no responde a toques.
12. Modo elegir cartas: el botón Atrás de Android cancela el modo (no sale de la ciega ni de la pantalla).
13. Cerrar la app con cartas modificadas (pintadas, mejoradas, destruidas o duplicadas) → reabrir → "Continuar run": mazo, mejoras, consumibles e inventario siguen igual.
14. Una run guardada antes de esta rama (versión 1): se descarta con el mensaje de siempre y deja empezar una nueva (ahora el guardado es versión 2). Si no tienes una guardada con la versión vieja, instala primero el build de `main`, empieza una run, y luego abre la app de esta rama.
15. Ver mazo: desde "Mazo n" en la ciega y "Ver mazo · N" en la tienda se abre el visor con cartas por palo (52, 53 tras `twin`, menos tras `scrap`); un palo sin cartas dice "Sin cartas"; la lista se puede recorrer con scroll.
16. Fin de run y nueva run con la misma semilla: mismas manos y mismas ofertas (determinismo).
17. Texto del sistema al 130 %: en la bandeja y en la hoja ningún texto se corta; la fila de herramientas (bandeja, mazo, niveles) no se sale del ancho.
18. Ancho 360 px (A56 con "Tamaño de pantalla" en el mínimo, o emulador): la etiqueta de mejora en el abanico de la mano no tapa el índice de la carta, ni con 8 cartas solapadas. Probar también con 9 y 10 cartas en la mano (usar `twin` una o dos veces seguidas): a 360 px el paso del abanico baja a unos 33,5 px (9 cartas) o 29,8 px (10), por debajo de `layout.card.minVisible` (38), y la etiqueta (unos 32 px de ancho) puede quedar parcialmente tapada. Según lo que se vea en el teléfono se decide si `computeFan` debe encoger las cartas.
19. Reducir movimiento activado (Ajustes de Android → Accesibilidad → Quitar animaciones): el modo elegir cartas, las hojas y la compra no tienen animaciones bruscas y todo sigue funcionando.
20. TalkBack: las cartas con mejora se leen con el nombre de la mejora; el error de un consumible se anuncia; el visor se lee por sección (palo).
21. Flujo de Maestro (`maestro test apps/mobile/.maestro/`): semilla `E2E-9` → jugar Full → tienda → `buy-0` compra un joker (`joker-j1` visible). Debe seguir verde.

## Qué mirar del balance

- El simulador (`pnpm sim:balance`) da 5,2 % de victorias contra 7,8 % de la línea base anterior a la 5a. El bot solo usa estudios (no pinta, ni destruye, ni duplica), y la tienda ahora gasta parte del dinero en consumibles que el bot casi no aprovecha, por eso baja.
- Si al jugar se siente demasiado difícil, la primera palanca es `shopConsumableOffers` de 2 a 3 (más consumibles por tienda), antes de tocar precios o objetivos.
- Preguntas para el usuario: ¿2 espacios alcanzan?, ¿los precios de los consumibles ($3 los estudios y tintas) se sienten bien frente a los jokers ($5–6)?, ¿se entiende sin explicación la diferencia entre etiqueta rellena y con contorno?

## Pendiente de revisión del usuario

El diseño de UI (`docs/design/fase5a-consumibles-diseno.md`) lo aprobó el controlador del plan por delegación; el usuario aún debe revisarlo (en particular: dos toques para "Aplicar" de Chatarra y el acceso al visor desde el contador "Mazo n").
