# 0008. Reglas de Hold'em No-Limit del Modo Mesa
Estado: Aceptado
Fecha: 2026-10-03

## Contexto
La Fase 1 implementó Hold'em en `packages/engine` y dejó varias reglas con más de una interpretación posible. El usuario las validó. Este ADR fija cómo funcionan; el código (`packages/engine/src/holdem/`) y sus tests son la referencia exacta.

## Decisión

**Posiciones: dead button completo.**
- La ciega grande avanza siempre al siguiente jugador activo. La posición de la ciega chica es el asiento de la ciega grande anterior, y el botón va a la posición de la ciega chica anterior, aunque ese asiento esté vacío (botón muerto) o su jugador ya no reciba cartas (ciega chica muerta: nadie la paga).
- Al pasar de heads-up a 3 o más jugadores, si el botón quedara sobre la ciega grande, se pone en el asiento justo antes de la ciega chica.
- Heads-up: el botón paga la ciega chica, actúa primero preflop y último después del flop. Nadie paga la ciega grande dos manos seguidas.
- **Ciegas perdidas:** quien está *sitting out* cuando la ciega grande lo saltea debe la ciega grande; si estaba en la posición de la ciega chica, la debe también.
- **Jugadores nuevos** (después de la primera mano de la mesa) deben la ciega grande. Quien debe ciegas elige: esperar a que le toque la ciega grande (por defecto) o pagar para entrar ya (`postBlindsToEnter`): ciega grande viva (cuenta como su apuesta y le da la opción de pasar) y ciega chica muerta (va al bote principal). No se puede entrar pagando desde la zona muerta (del botón a la posición de la ciega chica).
- En heads-up, o si no hubiera al menos 2 jugadores para repartir, las ciegas debidas se perdonan.

**Apuestas.**
- Subida mínima = tamaño de la última apuesta o subida completa. Postflop la apuesta mínima es la ciega grande, salvo all-in.
- Un all-in que no completa una subida no reabre la acción a quien ya actuó; varios all-in cortos que sumados alcanzan una subida completa sí la reabren (regla TDA).
- Si la ciega grande está all-in por menos, los demás igual pagan la ciega grande completa.
- No se puede apostar ni subir si nadie más puede responder.

**Timeout de turno:** pasa si puede, si no se retira; el jugador queda *sitting out* desde la mano siguiente (y desde ahí acumula ciegas perdidas).

**Showdown.**
- Si algún jugador que llegó al showdown está all-in, se muestran todas las manos (exposición all-in de la TDA).
- Si no, muestra primero el último agresor de la última ronda (o el primer jugador a la izquierda del botón si nadie apostó), y el resto muestra solo para cobrar un bote: los perdedores tiran sus cartas automáticamente y nadie las ve.
- Ficha impar: una por ganador, empezando por el primero a la izquierda del botón.

**Otros.** Irse a mitad de mano retira al jugador al instante (si está all-in sigue hasta el final) y el asiento se libera al liquidar. Quien se queda sin fichas pasa a *sitting out* y tiene que levantarse y volver a sentarse para recomprar. `voidHand` devuelve los stacks del inicio de la mano; el botón no retrocede.

## Consecuencias
- El estado de cada asiento guarda las ciegas que debe (`owesBigBlind`, `owesSmallBlind`) y su preferencia de entrada; la mesa guarda las posiciones de la última mano. El cliente lo ve en `viewFor` para mostrar "esperando la ciega grande" o "pagar para entrar".
- El muck es automático: no hay una fase de decisión ni un temporizador extra en el showdown.

## Fuera de alcance
Antes, straddle, run-it-twice, time bank, recompra parcial (top-up) y mostrar voluntariamente una mano ganada sin showdown.
