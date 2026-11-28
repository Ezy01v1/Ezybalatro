# Fase 5a — Diseño de la UI de consumibles

Producido con el modo DISEÑAR de `disenador-ui-ux`. Extiende `docs/design/fase2-roguelike-diseno.md` (dirección B "Gran Salón") y usa solo los tokens de `apps/mobile/src/theme/tokens.ts`; las únicas adiciones propuestas están en §9. Plan: `docs/superpowers/plans/2026-11-24-fase5a-consumibles.md` (Tasks 8–10).

## 0. Lente del producto

- **Usuario + trabajo:** jugador casual, una mano, 360 px, que dentro de una ciega quiere moldear su mazo (pintar, subir, destruir, duplicar, mejorar cartas) y en la tienda comprar y usar estudios, sin perder de vista cuánto le falta para el objetivo.
- **Objeto de primera lectura:** no cambia: puntaje vs objetivo. En modo elegir cartas, lo primero que se lee es **qué consumible está usando y cuántas cartas debe elegir**.
- **Acción primaria:** en juego normal, Jugar mano (sin cambios). En modo elegir cartas, **Aplicar**.
- **Frecuencia:** tocar la bandeja es ocasional (0–3 veces por ciega); jugar/descartar sigue siendo lo diario. Raro y riesgoso: vender un consumible sin querer, destruir cartas sin querer, jugar una mano creyendo que se está eligiendo objetivo.
- **Contexto:** Android de gama media, pulgar, 360×640 mínimo, sol (contraste), sonido apagado: ningún dato vive solo en color ni en sonido.

## 1. Contrato de diseño

```
Usuario + trabajo: ver sus 2 consumibles, usarlos o venderlos, elegir cartas objetivo y comprobar el mazo.
Objeto de primera lectura: (normal) puntaje vs objetivo; (elegir cartas) nombre del consumible + "Elige hasta 3 cartas".
Acción primaria: Aplicar (modo elegir cartas); Comprar (tienda).
Densidad: compacta en la ciega (la bandeja comparte la fila de "Ordenar"); equilibrada en la tienda.
Jerarquía (ciega): puntaje → jugada/instrucción → mano y acciones → bandeja/orden/mazo → comodines.
Modelo de interacción: bandeja de 2 espacios fijos → hoja de detalle → (modo elegir cartas sobre la misma mano) → aplicar.
  El visor del mazo es una hoja de solo lectura.
Prioridad responsive: 360 fija la fila de herramientas [Ordenar | bandeja | Mazo]; la bandeja es la que se estira
  (flex). A 412+ las tarjetas de la mano crecen como hoy; la bandeja gana ancho, no alto.
Referencias (lección transferible, sin copiar estilo):
  - Slay the Spire (pociones): espacios fijos siempre visibles, vacíos incluidos → la capacidad se lee sin abrir nada.
  - Hearthstone (hechizos con objetivo): elegir objetivo es un modo con "cancelar" explícito y el resto de la
    interfaz deja de ofrecer otras acciones → imposible jugar una mano "por error".
  - Stardew Valley (barra de herramientas): una fila fija de objetos usables bajo la acción principal.
  - Constructores de mazos (listas por grupo con conteo en el encabezado): agrupar y contar antes de listar.
Defaults prohibidos: bolsa/cuadrícula de inventario; diálogo "¿Seguro?" al aplicar; tooltips por mantener presionado;
  hoja dentro de hoja; tipo de consumible o de mejora comunicado solo por color; insignia como cinta que tapa el
  índice de la carta; cajas gemelas azul/roja; fondos animados.
Evidencia de terminado: §12.
```

## 2. Bandeja de consumibles (`ConsumableTray`)

### Dónde vive

- **Ciega (`GameScreen`):** en la fila que hoy tiene "Ordenar" a la izquierda y "Mazo 36" a la derecha, que pasa a ser la **fila de herramientas**: `[Valor|Palo] [espacio 1][espacio 2] [Mazo 36]`. Esa fila sube de 40 a **48 px** (= `touchTarget`).
- **Presupuesto vertical:** la suma fija pasa de ~484 a **~492 px**. Se encoge solo la **zona de jugada** (`styles.playZone`, `flex: 1`): a 360×640 baja de ~120 a **~112 px** (el contenido del `HandPreview` mide ~64 px centrado, y `minHeight: 96` de `preview` sigue cumpliéndose). Cambiar `playZone.minHeight` de 120 a **104**. A 412×915 el cambio se absorbe. Nada más se mueve: ni comodines, ni mano, ni barra de acciones.
- **Ancho (328 px útiles a 360):** Ordenar 2×56 = 112, contador "Mazo" ~56, 2 huecos de 8 → quedan 144 para los espacios: **68×48 cada uno** (flex 1, `minWidth` 56). Subir `sortItem.minWidth` de 64 a 56. Texto del contador y de los espacios con `maxFontSizeMultiplier={layout.fixedBoxFontScale}`.
- **Tienda (`ShopScreen`, con scroll):** bajo el riel de comodines, sección "Tus consumibles" con la misma bandeja en variante **wide** (cada espacio mide la mitad del ancho × 56 px, muestra el nombre completo). A la derecha del rótulo, botón ghost "Ver mazo · 52" (`deck-open`, 48 px de alto).

### Qué muestra cada espacio

| Estado | Compacto (ciega, 68×48) | Wide (tienda, ~160×56) |
|---|---|---|
| Ocupado | línea 1: tipo en `caption` `muted` ("Estudio", "Mejora", "Tinta", "Ascenso", "Chatarra", "Gemelo"); línea 2: `short` en `caption` negrita `primary` ("Par", "Reforzada", "Corazones"). 1 línea cada una, `adjustsFontSizeToFit`, `minimumFontScale 0.7` | nombre completo en `bodyMedium` (2 líneas máx.) + tipo en `caption` `muted` |
| Vacío | borde punteado `border`, texto "Vacío" `caption` `muted` | igual, "Espacio libre" |
| Activo (en modo elegir cartas) | borde 2 px `primary` + fondo `surfaceRaised`; no responde al toque | igual |
| Atenuado (otro espacio durante elegir cartas, o puntuando / ciega superada) | opacidad 0.45, `accessibilityState.disabled` | igual |

### Cómo se distingue de los comodines

Los comodines son tarjetas **verticales** 58×80, borde latón (`primary`), marco interior y viven en su propia fila. Los consumibles son **boletos horizontales** (68×48 / ~160×56): fondo `surface` (no `surfaceRaised`), borde de 1 px `chips` (jade), sin marco interior, esquinas `radii.sm`, texto en dos líneas. Además están en otra fila y con otro rótulo accesible. El tipo se lee por la palabra, no por el color.

### Accesibilidad

- Contenedor: `accessibilityLabel="Consumibles"`.
- Espacio ocupado: `accessibilityRole="button"`, label `"{name}: {description}"`, hint "Toca para ver opciones". Con la bandeja inactiva, `accessibilityState={{ disabled: true }}` y hint "No disponible mientras se cuenta el puntaje".
- Espacio vacío: label "Espacio de consumible vacío"; no es botón.
- Área táctil: 48 px de alto en ambas variantes; el ancho mínimo de 56 supera el mínimo AA de 24.

## 3. Hoja de detalle (`ConsumableSheet`)

Reutiliza `Sheet` (como `JokerDetailSheet`). Estructura: título = nombre; descripción centrada (`body`); línea `caption` `muted` con el alcance; botón primario **Usar**; botón secondary **Vender $n**; ghost **Cerrar**.

```
        Tinta de Corazones
  ───────────◇───────────
  Convierte de 1 a 3 cartas en corazones.
  Se usa sobre 1 a 3 cartas de tu mano.
  [          Usar          ]   primary 48
  [       Vender $1        ]   secondary → "Confirmar venta $1"
  [         Cerrar         ]   ghost
```

| Contexto | Usar | Vender | Razón visible |
|---|---|---|---|
| Tienda, estudio | activo | activo | — |
| Tienda, con cartas | **inactivo** (`inactive`) | activo | "Elige esto en una ciega" en `caption` `muted` bajo Usar; también `accessibilityHint` del botón |
| Ciega, estudio | activo | activo | — |
| Ciega, con cartas | activo | activo | — |
| Puntuando / ciega superada | la hoja no se puede abrir (bandeja inactiva) | — | — |

- **Usar sin cartas (estudio):** inmediato. `applyConsumable(instanceId)`; si devuelve `null`: cierra la hoja, `playSound('select')`, `haptics.select()` y avisa con `Notice` "Par sube al nivel 3" (el nivel se lee de `run.handLevels` ya actualizado). Si devuelve un código: la hoja queda abierta y muestra el error (§7) en `danger`, `accessibilityLiveRegion="polite"`, `testID="consumable-error"`.
- **Usar con cartas (solo en ciega):** `beginTargeting(instanceId)`, cierra la hoja, `haptics.select()`. No gasta nada hasta Aplicar.
- **Vender:** dos toques en el mismo botón con `useArmed` (idéntico a los comodines). Valor mostrado = `consumableSellValue` (mínimo $1). Al confirmar: `sellConsumable`, `playSound('coin')`, cierra, `Notice` "Vendido por $1". Permitido en tienda y ciega. Cerrar la hoja desarma la venta.

## 4. Modo elegir cartas ("targeting")

Entra con **Usar** en un consumible con cartas durante la ciega. Salir: **Cancelar**, **Aplicar** con éxito, el botón Atrás de Android (`BackHandler` → `cancelTargeting`) o terminar la run. No se guarda en disco.

### Qué cambia en la pantalla de la ciega

| Zona | Normal | Elegir cartas |
|---|---|---|
| `BlindBar`, `ScoreHeader` | igual | igual (el objetivo sigue a la vista) |
| Comodines | activos | opacidad 0.5, sin toque ni arrastre |
| Zona de jugada | `HandPreview` | **`TargetingPanel`**: `surface`, borde 1 px `primary`, `radii.md`; nombre del consumible (`title`), instrucción (`body`), aviso en `danger` si destruye |
| Fila de herramientas | Ordenar · bandeja · Mazo | Ordenar y Mazo siguen activos; el espacio en uso tiene borde 2 px; el otro, atenuado; ninguno responde |
| Mano | seleccionar hasta 5 | igual (subir 16 px + borde); el tope es `targets.max` |
| Barra de acciones | [Descartar] [Jugar mano] | **`TargetingBar`**: [Cancelar] (secondary, 40 %) [Aplicar 2/3] (primary, 60 %) |

Lo que impide jugar una mano por error: la barra Jugar/Descartar **no existe** en este modo (no está deshabilitada, no está), el panel enmarcado ocupa el lugar de la vista previa y, además, el store ignora `play`/`discard` mientras haya `targeting`. La diferencia no depende del color: cambian los textos, los botones y la presencia del panel.

```
Texto de instrucción (es.consumables.targeting):
  max = min        → "Elige 1 carta" / "Elige 2 cartas"
  min=1, max>1     → "Elige hasta 3 cartas"
  min>1            → "Elige de 2 a 3 cartas"
Contador: dentro del botón, como "Jugar mano 4": "Aplicar  2/3".
```

- **Reglas:** Aplicar `inactive` con `n < min` (hint "Elige al menos 1 carta"). Con `n == max`, tocar otra carta: `haptics.limit()` y la instrucción cambia 1,5 s a "Solo puedes elegir 3" (`mult`), restaurándose después. Cambiar de selección es libre; Cancelar limpia la selección.
- **Error al aplicar** (`applyConsumable` devuelve código): se queda en el modo, conserva la selección, `haptics.limit()` y la línea del panel muestra el texto de §7 en `danger` hasta que cambie la selección.
- **Éxito:** `playSound('deal')`, `haptics.select()`, sale del modo, la mano muestra las caras nuevas (la cara viene de `card.rank/suit`, nunca del `id`; el `key` de React sigue siendo el `id`, así que la carta cambia **en su sitio**). Con `scrap`/`twin` la mano se rellena y las cartas nuevas usan la entrada de reparto existente. Opcional (no bloquea): pulso de 180 ms (`pulseKey`) en las cartas cambiadas.
- **Mientras corre la animación de puntaje (`playback`) o con la ciega superada (`roundSummary`):** la bandeja está inactiva (§2) y nadie puede entrar al modo. Si `targeting` fuera no nulo al empezar un puntaje (no debería), el panel se oculta.
- **Movimiento reducido:** el panel y la barra aparecen con fundido de 120 ms, sin desplazamiento; con movimiento normal, el panel entra con `FadeInDown` 220 ms (`out`, 8 px). Sin animaciones de layout. Todo en `transform`/`opacity`.
- **Retroalimentación:** ninguna es la única señal (siempre hay texto o cambio de cara). Háptica y sonidos solo con lo que ya existe en `@/feedback/feedback`: entrar `haptics.select`; límite o error `haptics.limit`; aplicar `haptics.select` + `playSound('deal')`; vender `playSound('coin')`.

## 5. Marca de mejora en la carta (`EnhancementBadge`)

Una **etiqueta de 3 letras** en la esquina **inferior izquierda** de la carta (`left`/`bottom` = `spacing.xs`, alto `spacing.lg` = 16, `paddingHorizontal` `spacing.xs`, texto 11 px negrita, `maxFontSizeMultiplier 1`). Por qué ahí: el índice (rango + palo) ocupa de y=5 a y≈45 y x=6–32; el abanico deja ver los 38 px de la izquierda; la esquina inferior izquierda queda libre y visible, y el palo grande de abajo a la derecha es la parte que el abanico tapa. En 60×84 la etiqueta empieza en y≈64: no toca el índice.

- **Forma = momento en que actúa** (legible sin color): **relleno** (`primary` con texto `primaryFg`) = actúa **al puntuar**; **contorno** (borde 1 px `card.ink`, fondo transparente, texto `card.ink`) = actúa **mientras la carta se queda en tu mano**.
- **Texto:** `Ref` Reforzada · `Car` Cargada · `Dor` Dorada · `Vol` Volátil (al puntuar, rellenas) · `Anc` Ancla · `Pes` Pesada (en mano, contorno).
- Contraste: `primaryFg` sobre `primary` ≈ 8:1; `card.ink` sobre `card.face` ≈ 15:1.
- **Etiqueta accesible de la carta:** `"{Rango} de {palo}, {mejora}"` (+ ", no puntúa por el jefe" si aplica). Ej.: "Rey de corazones, Reforzada".
- **Etapa de puntaje:** `ScoringStage` ya usa `PlayingCard`: la etiqueta se ve sin cambios; el pulso y el "+25" flotante existentes marcan cuándo actúa.
- **Cara = verdad:** el palo y el rango pintados vienen de `card.suit` y `card.rank`. Una carta `Ks` pintada de corazones muestra ♥ y se anuncia "Rey de corazones". Ningún componente nuevo puede usar `card.id` para dibujar ni para etiquetar (los `testID` sí usan el `id`).
- Se dibuja encima del rayado del jefe (el candado ⊘ sigue arriba a la derecha).

## 6. Visor del mazo (`DeckSheet`)

Se abre con el contador "Mazo 36" de la ciega (que pasa a ser un botón `deck-open` de 48 px de alto; **decisión:** `BlindBar` ya está llena con el chip del jefe y el contador es lo que el jugador ya mira) y con "Ver mazo · N" en la tienda.

- **Encabezado fijo (no hace scroll):** título "Tu mazo"; resumen `body`: "52 cartas · 36 por robar" (en la tienda solo "52 cartas"); leyenda `caption` `muted`: "Etiqueta rellena: actúa al puntuar. Con contorno: actúa en tu mano."
- **Cuerpo:** `ScrollView` con `maxHeight = 50 % del alto de ventana` (≈320 px a 640: se ven ~2,3 palos, el corte del tercero avisa que hay más; ≈457 a 915), indicador de scroll visible.
- **Agrupación:** cuatro secciones en el orden de `SUIT_NAMES` (picas, corazones, diamantes, tréboles). Encabezado de sección: `SuitIcon` + "Corazones" + conteo ("14") en `numeric`. Dentro: **fichas** de 36×50 (`layout.deckTile`, §9) ordenadas por `card.rank` descendente (A→2), `flexWrap` con `gap spacing.xs`: 8 por fila a 360 (2 filas por palo), 9 a 412. Los duplicados quedan juntos.
- **Ficha:** `card.face`, borde `card.edge`; rango 14 px arriba, `SuitIcon` de 12 px al centro, `EnhancementBadge` (variante `tile`, misma forma y texto) abajo. Una carta con palo cambiado aparece **en el palo nuevo**; un rango subido, en su nuevo valor.
- **Palo sin cartas:** "Sin cartas" en `caption` `muted`.
- **A11y:** cada sección es **un solo elemento** `accessible` con label "Corazones: 14 cartas. As, Rey Reforzada, Reina, …" (las fichas internas con `accessible={false}`, sin ocultarlas del árbol para que los tests las encuentren). Títulos con `accessibilityRole="header"`. Botón Cerrar al final (`deck-close`).
- Solo lectura: las fichas no son tocables (no aplica objetivo táctil).

## 7. Oferta de consumible en la tienda

Reemplaza la tarjeta "Estudio" actual. Mismo `OfferCard`, ramificado por `offer.kind`:

- **Secciones:** dos rótulos `caption` `muted`: "Comodines" (ofertas `joker`) y "Consumibles" (ofertas `consumable`), cada uno antes de sus tarjetas. Se agrupa al renderizar pero el `index` y los `testID` (`offer-<i>`, `buy-<i>`) siguen siendo los de `run.shop`.
- **Tarjeta:** título (`subtitle`) = nombre; descripción (`caption` `muted`); línea de uso (`caption` `muted`): "Se usa en la tienda o en una ciega" (estudios) / "Se usa durante una ciega" (con cartas); pie con estado a la izquierda y **Comprar $n** a la derecha.
- **Estados del pie** (prioridad): Comprado → **Espacios llenos** (consumibles; `inactive`, sin `onPress`) → "Te faltan $n" (`danger`) → vacío. Los comodines siguen con "Comodines llenos". Si una compra falla igual (`NO_CONSUMABLE_SLOT`): `Notice` "No hay espacio para otro consumible".
- La bandeja wide, justo encima, muestra el espacio nuevo ocupado tras comprar (entrada de 220 ms con escala 0.9→1, `out`; con movimiento reducido, fundido de 120 ms).

## 8. Textos (es-419) — para pegar en `apps/mobile/src/i18n/es.ts`

Extiende la forma del plan: `CONSUMABLE_TEXTS` suma `kind` y `short`; `ENHANCEMENT_TEXTS` suma `timing`. Los estudios se generan con `HAND_CATEGORIES.map` y `HAND_NAMES`. Sin símbolos ♥ en estos textos (se usan palabras para evitar el problema de emoji de Android).

```ts
export const ENHANCEMENT_TEXTS: Record<string, { name: string; short: string; description: string; timing: 'scored' | 'held' }> = {
  reinforced: { name: 'Reforzada', short: 'Ref', timing: 'scored', description: '+25 fichas al puntuar.' },
  anchor:     { name: 'Ancla',     short: 'Anc', timing: 'held',   description: '×1,5 mult mientras se queda en tu mano.' },
  charged:    { name: 'Cargada',   short: 'Car', timing: 'scored', description: '+4 mult al puntuar.' },
  gilded:     { name: 'Dorada',    short: 'Dor', timing: 'scored', description: '+$2 al puntuar.' },
  heavy:      { name: 'Pesada',    short: 'Pes', timing: 'held',   description: '+30 fichas mientras se queda en tu mano.' },
  volatile:   { name: 'Volátil',   short: 'Vol', timing: 'scored', description: '×1,3 mult al puntuar.' },
};
```

| id | kind | name | short | description |
|---|---|---|---|---|
| `study_<mano>` (9) | Estudio | `Estudio: ${HAND_NAMES[h]}` | `HAND_NAMES[h]`; solo `straight_flush` → "Esc. color" | `Sube un nivel la mano ${HAND_NAMES[h]}: más fichas y más mult.` |
| `reinforce` | Mejora | Refuerzo | Reforzada | Da «Reforzada» a 1 o 2 cartas: +25 fichas al puntuar. |
| `charge` | Mejora | Carga | Cargada | Da «Cargada» a 1 o 2 cartas: +4 mult al puntuar. |
| `gild` | Mejora | Dorado | Dorada | Da «Dorada» a 1 o 2 cartas: +$2 al puntuar. |
| `weigh` | Mejora | Lastre | Pesada | Da «Pesada» a 1 o 2 cartas: +30 fichas si se quedan en tu mano. |
| `anchor_card` | Mejora | Anclaje | Ancla | Da «Ancla» a 1 o 2 cartas: ×1,5 mult si se quedan en tu mano. |
| `volatilize` | Mejora | Volatilizar | Volátil | Da «Volátil» a 1 o 2 cartas: ×1,3 mult al puntuar. |
| `paint_s` | Tinta | Tinta de Picas | Picas | Convierte de 1 a 3 cartas en picas. |
| `paint_h` | Tinta | Tinta de Corazones | Corazones | Convierte de 1 a 3 cartas en corazones. |
| `paint_d` | Tinta | Tinta de Diamantes | Diamantes | Convierte de 1 a 3 cartas en diamantes. |
| `paint_c` | Tinta | Tinta de Tréboles | Tréboles | Convierte de 1 a 3 cartas en tréboles. |
| `elevate` | Ascenso | Ascenso | +1 valor | Sube 1 valor a 1 o 2 cartas (un 9 pasa a 10). El As no sube. |
| `scrap` | Chatarra | Chatarra | Destruir | Destruye 1 o 2 cartas de tu mazo para siempre. |
| `twin` | Gemelo | Gemelo | Copiar | Añade a tu mazo una copia de 1 carta, con su mejora. |

Cadenas nuevas (`es.consumables`; las existentes `es.shop.sell`, `sellConfirm`, `es.game.close` se reutilizan):

```ts
consumables: {
  trayLabel: 'Consumibles', emptySlot: 'Espacio de consumible vacío', emptyShort: 'Vacío', emptyWide: 'Espacio libre',
  slotHint: 'Toca para ver opciones', slotInactiveHint: 'No disponible mientras se cuenta el puntaje',
  use: 'Usar', onlyInBlind: 'Elige esto en una ciega',
  targetsInfo: (min: number, max: number) => min === max
    ? `Se usa sobre ${max} ${max === 1 ? 'carta' : 'cartas'} de tu mano.` : `Se usa sobre ${min} a ${max} cartas de tu mano.`,
  whereAny: 'Se usa en la tienda o en una ciega', whereBlind: 'Se usa durante una ciega',
  used: (name: string) => `Usaste ${name}`, studyUsed: (hand: string, level: number) => `${hand} sube al nivel ${level}`,
  sold: (n: number) => `Vendido por $${n}`,
  targeting: {
    pick: (min: number, max: number) => min === max ? `Elige ${max} ${max === 1 ? 'carta' : 'cartas'}`
      : min === 1 ? `Elige hasta ${max} cartas` : `Elige de ${min} a ${max} cartas`,
    limit: (max: number) => `Solo puedes elegir ${max}`, minHint: (min: number) => `Elige al menos ${min} ${min === 1 ? 'carta' : 'cartas'}`,
    panelA11y: (name: string, n: number, max: number) => `Usando ${name}, ${n} de ${max} cartas elegidas`,
    apply: 'Aplicar', cancel: 'Cancelar', destroyWarning: 'Se destruyen para siempre.',
  },
  errors: {
    noSlot: 'No hay espacio para otro consumible',
    pickBetween: (min: number, max: number) => min === max ? `Elige ${max} ${max === 1 ? 'carta' : 'cartas'}` : `Elige entre ${min} y ${max} cartas`,
    invalidCards: 'Esas cartas no sirven para esto. Prueba con otras.', elevateAce: 'El As ya no puede subir.',
    scrapMin: (n: number) => `Tu mazo no puede tener menos de ${n} cartas.`,
    invalidConsumable: 'Ese consumible ya no está disponible.', invalidPhase: 'Elige esto en una ciega',
    generic: 'No se pudo usar. Inténtalo de nuevo.',
  },
  deck: {
    title: 'Tu mazo', open: 'Ver mazo', openA11y: (n: number) => `Ver mazo, ${n} cartas`,
    total: (n: number) => `${n} cartas`, drawLeft: (n: number) => `${n} por robar`, emptySuit: 'Sin cartas',
    legend: 'Etiqueta rellena: actúa al puntuar. Con contorno: actúa en tu mano.',
    suitA11y: (suit: string, n: number, list: string) => `${suit}: ${n} cartas. ${list}`,
  },
},
// En es.shop: consumables: 'Consumibles' (antes 'Estudios'), fullConsumables: 'Espacios llenos', yourConsumables: 'Tus consumibles'.
// Quitar es.shop.levelUp y levelUpDesc cuando ya nada los use.
```

Mapa de errores (copy, no reglas): `NO_CONSUMABLE_SLOT`→`noSlot`; `INVALID_PHASE`→`invalidPhase`; `INVALID_CONSUMABLE`→`invalidConsumable`; `INVALID_CARDS` → `elevateAce` si el consumible es `elevate`, `scrapMin(run.config.minDeckSize)` si es `scrap` y la cantidad está dentro de `targets`, `pickBetween` si la cantidad está fuera de `min..max`, si no `invalidCards`; el resto → `generic`.

## 9. Tokens

Todo usa tokens existentes. Se proponen tres adiciones mínimas a `tokens.ts`:

- `layout.consumableSlot = { minWidth: 56, height: 48, heightWide: 56 }` (48 = `touchTarget`).
- `layout.deckTile = { width: 36, height: 50 }` (separación: `spacing.xs`).
- `motion.noticeMs = 2500` (duración del aviso).

La etiqueta de mejora usa `spacing.lg` (alto), `spacing.xs` (margen y relleno) y `colors.primary/primaryFg/card.ink`: sin tokens nuevos.

## 10. Contratos de componentes

| Componente (archivo) | Props | Estados | testID | Lee del store |
|---|---|---|---|---|
| `ConsumableTray` (`roguelike/ConsumableTray.tsx`, nuevo) | `run`, `onPress(instanceId)`, `variant?: 'compact'\|'wide'` (def. compact), `disabled?: boolean`, `activeId?: string\|null` | por espacio: vacío · ocupado · activo · atenuado | `consumable-tray`; `consumable-slot-<n>` con **n = 1, 2** (posición, también en vacíos) | nada (puro; el padre pasa `disabled = !!playback \|\| !!roundSummary \|\| !!targeting` y `activeId = targeting?.instanceId`) |
| `ConsumableSheet` (nuevo) | `run`, `instanceId: string\|null`, `onClose`, `onUsed?(message)` | ver tabla §3; `armed` de venta; error en línea | `consumable-detail`, `consumable-use`, `consumable-use-reason`, `consumable-sell`, `consumable-error` | acciones `applyConsumable`, `beginTargeting`, `sellConsumable`; `run.phase`, `findConsumable` |
| `TargetingPanel` (en `GameHud.tsx`) | `consumableId`, `count`, `error?: string\|null`, `limitHit?: boolean` | instrucción · límite · error · aviso de destruir | `targeting-panel`, `targeting-hint` | — (el padre lee `selected`, `targeting`) |
| `TargetingBar` (en `GameHud.tsx`) | `count`, `min`, `max`, `onApply`, `onCancel` | Aplicar inactivo si `count < min` | `targeting-bar`, `targeting-apply`, `targeting-cancel` | — |
| `GameScreen` (cambia) | igual | fila de herramientas; modo elegir cartas; `Notice` | `deck-open` (contador), `notice` | `targeting`, `selected`, `playback`, `roundSummary`, `beginTargeting`, `cancelTargeting`, `applyConsumable` |
| `ShopScreen` (cambia) | igual | secciones, `OfferCard` por tipo, bandeja wide | `offer-<i>`, `buy-<i>` (sin cambio), `deck-open`, `notice` | `run.consumables`, `buy`, `sellConsumable`, `applyConsumable` |
| `EnhancementBadge` (`shared/EnhancementBadge.tsx`, nuevo) | `enhancement: string`, `size?: 'card'\|'tile'`, `testID?` | rellena (`scored`) · contorno (`held`) · id desconocido → no pinta | `card-badge-<cardId>` / `deck-badge-<cardId>` (los pasa el padre) | — |
| `PlayingCard` (cambia) | igual | suma la etiqueta si `card.enhancement`; el `accessibilityLabel` incluye el nombre | `card-<id>` (sin cambio) | — |
| `DeckSheet` (`roguelike/DeckSheet.tsx`, nuevo) | `visible`, `run`, `onClose` | con/sin mejoradas; palo vacío; 52–60 cartas | `deck-sheet`, `deck-total`, `deck-suit-<s>`, `deck-card-<id>`, `deck-close` | — (lee `run.deck`, `run.drawPile`) |
| `useTransientNotice` (`ui/useTransientNotice.ts`, nuevo) | `(ms = motion.noticeMs)` → `[message\|null, show(message)]` | `Notice` = `Text` `caption` en pastilla `surfaceRaised`, `accessibilityLiveRegion="polite"` | `notice` | — |

Notas: en la ciega la `Notice` flota **anclada abajo de la zona de jugada** (no cubre cartas ni botones); en la tienda ocupa una línea reservada de 20 px bajo la bandeja (sin saltos de layout). Los `testID` de cartas (`card-<id>`), `play-button`, `to-shop-button`, `buy-0` y `joker-j1` del Maestro **no cambian**. Las cartas modificadas del visor y de la mano se identifican por `id` solo en tests.

## 11. Wireframes a 360×640

Pantalla de la ciega, normal (alturas orientativas; la fila de herramientas es la única que crece, +8):

```
┌──────────────────────────────────────┐
│ Nivel 2 · Ciega grande          $12  │ 48
│ 1.240  de 1.800                      │ 72
│ ▓▓▓▓▓▓▓░░░░░░░░░                     │
│ ─────────────◇─────────────          │
│ [Brasa][Prisma][ — ][ — ][ — ]       │ 88 comodines (verticales)
│                                      │
│        Elige hasta 5 cartas          │ ~112 zona de jugada
│  (Notice: "Vendido por $1")          │
│ [Valor|Palo] [Estudio][ Vacío ] Mazo 36│ 48 herramientas
│    ▯ ▯ ▯ ▯ ▯ ▯ ▯ ▯  (mano)           │ 124
│ [ Descartar 3 ] [   Jugar mano 4   ] │ 64
└──────────────────────────────────────┘
        espacio = boleto 68×48, borde jade
```

Modo elegir cartas (`paint_h`, 2 elegidas de 3):

```
│ Nivel 2 · Ciega grande          $12  │
│ 1.240  de 1.800  ▓▓▓▓▓░░░            │
│ [Brasa][Prisma][ — ][ — ][ — ]  ←50 %│
│ ┌──────────────────────────────────┐ │
│ │ Tinta de Corazones               │ │ panel, borde primary
│ │ Elige hasta 3 cartas             │ │
│ └──────────────────────────────────┘ │
│ [Valor|Palo] [▣Tinta ][atenuado] Mazo 36│ activo: borde 2 px
│   ▯ ▯ ▲ ▯ ▲ ▯ ▯ ▯   (▲ = elegida, sube 16) │
│ [   Cancelar   ] [  Aplicar  2/3   ] │
```

Tienda con consumibles:

```
│ Tienda                          $12  │
│ ─────────────◇─────────────          │
│ Tus comodines                        │
│ [Brasa][ — ][ — ][ — ][ — ]          │
│ Tus consumibles       [Ver mazo · 52]│
│ [Estudio · Par     ][ Espacio libre ]│ 56
│ (aviso reservado 20 px)              │
│ Comodines                            │
│ ┌ Prisma · ×1,5 mult.      $6 [Comprar]┐ ┌ …
│ Consumibles                          │
│ ┌ Tinta de Corazones                ┐│
│ │ Convierte de 1 a 3 cartas…        ││
│ │ Se usa durante una ciega          ││
│ │ Espacios llenos      [Comprar $3] ││ ← inactivo
│ [ Renovar $3 ]                       │
├──────────────────────────────────────┤
│ [          Siguiente ciega         ] │ fijo
```

Hoja de detalle y visor del mazo:

```
┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐
│        Tinta de Corazones            │  │              Tu mazo                 │
│ ─────────────◇─────────────          │  │ 52 cartas · 36 por robar             │
│ Convierte de 1 a 3 cartas en         │  │ Rellena: al puntuar. Contorno: en mano│
│ corazones.                           │  │ ♠ Picas · 13                         │
│ Se usa sobre 1 a 3 cartas de tu mano.│  │ [A][K][Q][J][10][9][8][7]            │
│ [            Usar            ]       │  │ [6][5][4][3][2]                      │
│ Elige esto en una ciega (en tienda)  │  │ ♥ Corazones · 14  (↓ scroll)         │
│ [         Vender $1          ]       │  │ [A][K]Ref[Q][J][10][9][8] …          │
│ [          Cerrar            ]       │  │ [           Cerrar          ]        │
└──────────────────────────────────────┘  └──────────────────────────────────────┘
```

## 12. Evidencia de terminado

Verificar a **360×640** y **412×915**, con texto del sistema al **100 %** y **130 %**, y con **reducir movimiento** activado (sin red: irrelevante, el roguelike es offline).

- [ ] Bandeja con 0, 1 y 2 consumibles, en ciega y en tienda; a 130 % ningún texto se corta y la fila de herramientas no se sale del ancho.
- [ ] Hoja: razones de desactivado (tienda + con cartas), Usar inmediato de un estudio con aviso del nivel nuevo, Vender en dos toques y venta del valor correcto (mín. $1), cerrar desarma la venta.
- [ ] Modo elegir cartas: 0 cartas (Aplicar inactivo), mínimo, máximo (la 4.ª carta da límite + texto), Cancelar, Atrás de Android, error de `elevate` sobre un As y de `scrap` con mazo mínimo; la barra Jugar/Descartar no aparece en ningún momento.
- [ ] Durante el conteo de puntaje y con la ciega superada, la bandeja no responde.
- [ ] Etiquetas de las 6 mejoras en la mano (con 8 cartas solapadas, sin tapar el índice), en la etapa de puntaje y en el visor; la etiqueta accesible incluye el nombre; una carta pintada o subida muestra su cara nueva.
- [ ] Visor: 52, 53 (tras `twin`) y 60 cartas; palos con 0 cartas; scroll con 2,3 palos visibles a 640; lectura con TalkBack por sección.
- [ ] Tienda: Comprar con espacios llenos (estado "Espacios llenos"), con dinero justo, y compra de estudio → usar en la tienda → ver el nivel en el aviso.
- [ ] Contraste AA de etiqueta, panel y estados atenuados; ningún estado depende solo del color.

## 13. Preguntas abiertas y decisiones del controlador (2026-11-26)

1. **`consumable-slot-<n>` base 1:** **aprobado** (1 y 2).
2. **Forma de los textos:** **aprobado**: se añaden `kind`/`short` a `CONSUMABLE_TEXTS` y `timing` a `ENHANCEMENT_TEXTS` respecto al plan; el test de cobertura de la Task 8 exige también esos campos.
3. **Acceso al visor:** **aprobado**: desde el contador "Mazo n" (y "Ver mazo · N" en la tienda), no desde `BlindBar`.
4. **`scrap` con segunda confirmación (CAMBIO respecto a la propuesta del diseñador):** destruir cartas es irreversible, así que cuando el consumible en uso tenga una operación `destroyCards` (se lee de los datos de `CONSUMABLES`, sin `if` por id), **Aplicar** pide dos toques con `useArmed`: el primero cambia la etiqueta a "Confirmar: destruir" (`es.consumables.targeting.confirmDestroy`) durante 3 s; el segundo aplica. Cambiar la selección o cancelar desarma. Los demás consumibles aplican con un toque.
5. **Cartas modificadas:** **diferido**: el visor no resalta cuáles cambiaron (haría falta un campo nuevo en `RunCard`); no entra en la 5a.
6. **`useTransientNotice`/`Notice`:** **aprobado** (código chico y reutilizable; es la única adición fuera de la lista de archivos del plan).

Estado: propuesto por el diseñador; aprobado por el controlador del plan el 2026-11-26 por delegación del usuario; pendiente de revisión del usuario.
