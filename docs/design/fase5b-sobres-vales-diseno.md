# Fase 5b — Diseño de la UI de sobres y vales

Producido con el modo DISEÑAR de `disenador-ui-ux`. Extiende `docs/design/fase5a-consumibles-diseno.md` (dirección B "Gran Salón"); solo usa los tokens de `apps/mobile/src/theme/tokens.ts` salvo lo de §8. Reglas en `docs/superpowers/specs/2026-11-27-fase5b-sobres-vales-design.md` §5.2 y plan Tasks 7–9. Estado: aprobado por el controlador por delegación del usuario (2026-11-27), **pendiente de revisión del usuario**. Decisiones del controlador al implementar: `CardFace` es un componente nuevo y no se refactoriza `Tile` de `DeckSheet`; sin entrada escalonada ni pulso de escala en las filas del sobre (la hoja usa solo la entrada propia de `Sheet`).

## 0. Lente del producto

- **Usuario + trabajo:** jugador casual, una mano, 360 px, texto hasta 130 %, que entre ciegas decide en qué gastar: comodín, consumible, sobre, vale, renovar o ahorrar para el interés.
- **Objeto de primera lectura:** en la tienda, las ofertas y cuánto dinero tiene (el dinero ya está fijo en la cabecera). En la hoja del sobre, **las opciones y la instrucción "Elige 1"**.
- **Acción primaria:** Comprar (tienda); Elegir una opción (hoja del sobre).
- **Frecuencia:** abrir la tienda es lo más común (1 vez por ciega); un sobre se abre 0–2 veces por tienda; un vale se compra pocas veces por run, pero cambia las reglas para siempre. Raro y riesgoso: elegir mal en un sobre (irreversible), saltar un sobre pagado por un toque, no entender que un vale cuenta desde la siguiente ciega.
- **Contexto:** Android de gama media, pulgar, sol, sonido apagado; la app se puede cerrar con un sobre abierto.

## 1. Contrato de diseño

```
Usuario + trabajo: comprar entre 7 ofertas sin perderse; abrir un sobre y quedarse con 1 opción; recordar qué vales ya tiene.
Objeto de primera lectura: (tienda) ofertas; (sobre) 3 opciones + "Elige 1".
Acción primaria: Comprar; Elegir opción.
Densidad: equilibrada en la tienda, con filas COMPACTAS para sobres y vale; compacta en la hoja del sobre.
Jerarquía (tienda): dinero (fijo) → comodines → consumibles → Renovar → sobres → vale → vales comprados → Siguiente ciega (fijo).
Modelo de interacción: lista con scroll + pie fijo; el sobre es una hoja modal que no se puede descartar.
Prioridad responsive: 360 fija una columna; el botón de precio no cambia de ancho y el texto es lo que se estira.
  A 412+ solo ganan ancho las descripciones. Nada cambia de lugar.
Referencias (lección transferible, sin copiar estilo):
  - Slay the Spire (recompensa de cartas): elegir 1 de 3 con "Saltar" siempre visible → la hoja es corta y reversible solo saltando.
  - Hearthstone (descubrir): un conjunto de opciones bloquea el resto de la interfaz hasta resolverlo.
  - Tiendas de móvil (filas con precio a la derecha): nombre + efecto a la izquierda, un solo botón de precio → cada fila mide lo que dice.
  - Slay the Spire (reliquias de la tienda): lo permanente se rotula como tal, aparte de lo consumible.
Defaults prohibidos: cuadrícula de 7 tarjetas iguales; animación de "abrir sobre" con delay; sobre-que-se-puede-cerrar-con-gesto;
  rareza o tipo comunicados solo por color; "¿Seguro?" al elegir una opción; hoja dentro de hoja; tooltips por mantener presionado.
Evidencia de terminado: §9.
```

## 2. Tienda con siete ofertas

**El problema medido (360×640, texto 100 %):** el bloque fijo de arriba (comodines, consumibles, bandeja) ocupa ~286 px del scroll y cada `OfferCard` actual mide ~150–165 px. Tres tarjetas más serían +450 px: el vale quedaría a ~3 pantallas.

**Decisiones**
1. **Los 4 comodines/consumibles no cambian** (posiciones 0–3, misma tarjeta; está aprobada en la 5a).
2. **Sobres y vale usan una fila compacta (`OfferRow`)** de ~74 px (100 %) en vez de ~150: 3 filas ≈ 250 px en total en lugar de ≈ 470.
3. **Renovar sube** y queda justo bajo "Consumibles", con el rótulo "Solo cambia comodines y consumibles". Hoy estaría debajo del vale y parecería que renueva todo; renovar no toca sobres ni vale.
4. **Rótulos que dicen lo que implica**: "Sobres · se abren al comprarlos" y "Vale · mejora permanente" (`caption` `muted`, `accessibilityRole="header"`).
5. Si ya se compraron los 6 vales no hay oferta de vale: se omite la sección (sin estado vacío; la lista de §3 lo explica).
6. Dinero y "Siguiente ciega" siguen fijos fuera del scroll: el jugador ve su saldo al recorrer las 7 ofertas.

### `OfferRow` (sobre o vale)

| Parte | 100 % | 130 % |
|---|---|---|
| Contenedor | `surface`, borde 1 px `border`, `radii.md`, padding `spacing.sm` vertical × `spacing.md` horizontal, fila `gap spacing.sm`, `alignItems: center` | igual; la fila crece, nunca se corta |
| Columna de texto (`flex: 1`) | nombre `bodyMedium` (≤2 líneas) · línea 2 `caption` `primary` negrita: "Elige 1 de 3" (sobre) o el efecto corto "+1 mano" (vale) · línea 3 `caption` `muted`: descripción (≤3 líneas) · estado (si hay) `caption` | ~209 px de texto útil (328 − 24 − 87 − 8): ≈26 caracteres por línea, descripciones de ≤45 caracteres caben en 2 líneas |
| Botón de precio (`PriceButton`, derecha) | `primary`, mín. **80×48**, dos líneas centradas: "Comprar" (`caption` negrita) sobre "$6" (`button`) | ~87×56; sin tope de escala (no usa `fixedBoxFontScale`) |
| Altura | ~74 px (sin estado), ~92 con estado | ~115 / ~138 |

- **Vale:** igual, con borde izquierdo de 3 px `primary` (refuerzo; el rótulo "mejora permanente" ya lo dice con texto).
- **Por qué el precio va en un botón de dos líneas:** conserva el verbo ("Comprar") que pide la copia y cuesta 80 px, no los ~150 de "Comprar $10" en una línea; así queda ancho para el texto.
- **Comprado:** la fila baja a opacidad **0,7** (no 0,55 como `OfferCard`: a 0,55 la descripción `muted` cae a ≈3,3:1; a 0,7 queda ≈4,5:1, verificar en pantalla); "Comprado" a opacidad plena en la línea de estado; el botón sigue ahí (`buy-<i>`), inactivo, con una sola línea "Comprado" en lugar del precio.

```
(360 px; el resto de la pantalla como hoy)
│ Tienda                          $12  │ fijo
│ ─────────────◇─────────────          │
│  … ofertas de Comodines y Consumibles (sin cambios) …
│ [ Renovar $3 ] Solo cambia comodines │ 48
│                y consumibles        │
│ Sobres · se abren al comprarlos      │
│ ┌──────────────────────────────────┐ │
│ │ Sobre de comodines     ┌────────┐│ │
│ │ Elige 1 de 3           │Comprar ││ │ ~74
│ │ Comodines nuevos para  │   $6   ││ │
│ │ tu run.                └────────┘│ │
│ └──────────────────────────────────┘ │
│ ┌ Sobre de cartas · Elige 1 de 3 …  ┐│
│ Vale · mejora permanente             │
│ ┃ Mano de gracia          ┌────────┐ │
│ ┃ +1 mano                 │Comprar │ │
│ ┃ Una mano más en cada    │  $10   │ │
│ ┃ ciega, desde la siguiente└───────┘ │
│ Tus vales                            │
│ ( +1 descarte ) ( Renovar −$1 )      │
├──────────────────────────────────────┤
│ [          Siguiente ciega         ] │ fijo
```

Alargue total del scroll ≈ 1.320 px (≈3 pantallas a 640): aceptable porque el orden del scroll coincide con el orden de las decisiones. **Opcional, no ahora:** usar `OfferRow` también para comodines y consumibles ahorraría ~240 px más, pero rehace la 5a ya aprobada.

## 3. Vales comprados (`vouchers-owned`)

- **Dónde:** al final del scroll, bajo el vale (si lo hay), rótulo "Tus vales · N". **No** arriba: es información de consulta y arriba empujaría las ofertas ~60 px. Oculto por completo con 0 vales (sin rótulo ni hueco).
- **Forma:** píldoras no tocables (`radii.pill`, fondo `surfaceRaised`, borde 1 px `border`, texto `caption` `fg`) en fila con `flexWrap`, `gap spacing.sm`. Distintas de los comodines (tarjetas verticales latón) y de los consumibles (boletos jade) por forma (píldora) y por no ser botones.
- **Qué dicen:** el **efecto corto** ("+1 mano", "+1 descarte", "+1 espacio de comodín", "+1 espacio de consumible", "Renovar −$1", "Interés máx. +$1"), no el nombre de fantasía: el jugador entiende qué regla cambió sin abrir nada. Nombre y descripción completa van en la etiqueta accesible: `"{nombre}: {descripción}"`.
- **Por qué no tocables:** el efecto ya se leyó completo en la fila de compra y en el aviso de compra; una píldora que no hace nada no debe parecer un botón (sin sombra, sin altura de 48).
- A 130 % las píldoras largas ocupan una línea completa (~230 px) y el resto baja; no se corta texto.

## 4. Hoja del sobre (`PackSheet`)

Reutiliza `Sheet` **sin `onClose`** (el fondo ya no recibe toques). Vive en `ShopScreen`, visible mientras `run.openPack !== null`, también al reabrir la app (entra con el `SlideInDown`/`FadeIn` que ya trae `Sheet`; sin aviso extra: la hoja misma explica el bloqueo).

```
┌──────────────────────────────────────┐
│           Elige 1                    │ título (Sheet) = es.packs.pick(n, left)
│  ─────────────◇─────────────         │
│        Sobre de comodines            │ caption muted
│ ┌──────────────────────────────────┐ │ ScrollView, maxHeight 55 % de la ventana
│ │ ┌────┐ Prisma                    │ │ fila 1: opción
│ │ │ Pr │ ×1,5 mult en la mano…     │ │
│ │ └────┘                           │ │
│ │ ┌────┐ Tinta de Corazones        │ │ fila 2
│ │ │Cora│ Convierte de 1 a 3 cartas…│ │
│ │ └────┘                           │ │
│ │ ┌───┐  Rey de corazones          │ │ fila 3 (carta)
│ │ │K♥ │  Reforzada: +25 fichas al  │ │
│ │ │Ref│  puntuar.                  │ │
│ │ └───┘                            │ │
│ └──────────────────────────────────┘ │
│  Ya no tienes espacio para… (error)  │ reservado, 2 líneas
│ [          Saltar sobre            ] │ secondary 48, fuera del scroll
└──────────────────────────────────────┘
```

**Cabecera.** Título = "Elige 1" (si `picksLeft` = total) o "Elige 2 (quedan 1)"; es el `header` accesible. Debajo, el nombre del sobre en `caption` `muted`. Si alguna opción es carta: línea `caption` `muted` "Las cartas que elijas se añaden a tu mazo." El total de elecciones sale de los datos del sobre (`findPack(id).picks`), no de reglas en el componente.

**Fila de opción (`PackItemRow`)**: `Pressable`, `surfaceRaised`, borde 1 px `border`, `radii.md`, padding `spacing.sm`, alto mín. **80 px**, separación `spacing.sm` (8). Miniatura fija de **52×72** a la izquierda; a la derecha nombre `bodyMedium` (≤2 líneas) y descripción `caption` `muted` (≤3 líneas). Cada tipo se distingue por la miniatura (forma y texto, no color):

| Opción | Miniatura (52×72) | Nombre | Descripción |
|---|---|---|---|
| Comodín | tarjeta vertical `surfaceRaised`, borde 1 px `primary`, marco interior (misma gramática que `JokerRail`), `short` del comodín en `caption` | nombre del comodín | descripción del comodín |
| Consumible | boleto horizontal 52×40 centrado, fondo `surface`, borde 1 px `chips` (como la bandeja), `short` en `caption` | nombre del consumible | descripción + tipo ("Estudio", "Mejora"…) |
| Carta mejorada | **cara de carta** (`card.face`, borde `card.edge`): rango, `SuitIcon` y `EnhancementBadge` tamaño `tile` ("Ref"), con la forma rellena/contorno de la 5a | "Rey de corazones" | nombre y efecto de la mejora ("Reforzada: +25 fichas al puntuar.") |

La carta **no** usa `PlayingCard` (es un `Pressable` anidado, con `testID card-<id>`, posición absoluta y animaciones de la mano, y la carta aún no tiene `id`): se extrae `Tile` de `DeckSheet` a `CardFace` compartido (tamaños `tile` 36×50 y `pack` 52×72). La cara y la etiqueta salen de `rank/suit/enhancement`, nunca de un id.

**Estados de la fila**
- **Default**; **presionada** (`surface`→`secondaryPressed`); **elegida**: opacidad 0,7, borde `primary`, texto "Elegido" (`caption` negrita, plena) arriba a la derecha, `accessibilityState {disabled, selected}`, no responde; **con error** (tocó y no hubo espacio): borde 1 px `danger` hasta el siguiente toque.
- **Elegir es inmediato** (un toque, sin confirmación): `playSound('select')`, `haptics.select()`, pulso de escala 1→1,03→1 en 160 ms (`transform`); si era la última elección, la hoja se cierra, y en la tienda un `Notice` dice qué entró ("Añadido: Prisma" / "Se añadió a tu mazo: Rey de corazones, Reforzada"), el riel/bandeja o "Ver mazo · 53" ya muestran el cambio.
- **Entrada:** las filas aparecen escalonadas con `FadeInDown` 220 ms (`motion.stagger.deal` 40 ms, `out`); con "reducir movimiento", fundido de 120 ms sin escalonar ni desplazamiento. Al comprar el sobre suena `deal`.

**Error "sin espacio".** Línea de texto `caption` `danger` **persistente** (no un `Notice` de 2,5 s, que se pierde a 130 % o con TalkBack), con `testID="pack-error"`, `accessibilityLiveRegion="assertive"`, en un hueco reservado de 2 líneas entre la lista y "Saltar" para que nada salte. Se limpia al tocar otra opción con éxito. Más `haptics.limit()`. La copia no manda a vender (la tienda está bloqueada): dice que puede saltar.

**Salir.** No hay botón de cerrar ni gesto. **Saltar** es la única salida sin elegir: `secondary`, abajo, separado de la lista por el hueco del error (≥ 12 px), `testID="pack-skip"`. Si no se ha elegido nada, pide **dos toques** (`useArmed`, como vender): "Saltar sobre" → "Confirmar: saltar sin elegir" durante 3 s, porque el sobre ya está pagado y los 3 contenidos se pierden. Con ≥1 elección hecha el botón dice "Saltar el resto" y actúa al primer toque. Android Atrás no cierra la hoja (ver §6 sobre `Sheet`).

**Medidas a 360×640 / 130 %.** 100 %: cabecera ~110 + lista 3×88+16 = 280 + error 36 + Saltar 48 + relleno 48 ≈ 520 < 640. 130 %: la lista pasa de ~360 a su tope de 55 % de ventana (352 px) y hace scroll con barra visible (`persistentScrollbar`, como `DeckSheet`); cabecera, error y Saltar quedan siempre visibles.

## 5. Estados

| Estado | Fila de sobre / vale | Dónde se ve |
|---|---|---|
| Normal | botón "Comprar $n" activo | tienda |
| Sin dinero | estado "Te faltan $n" (`danger`, texto + color); botón inactivo (opacidad 0,45, sin `onPress`, `disabled`) | fila |
| Sin espacio (sobre de comodines o consumibles) | estado "Sin espacio: vende un comodín" / "Sin espacio: usa o vende un consumible"; botón inactivo. Sobre de cartas: nunca. Prioridad: Comprado → Sin espacio → Te faltan | fila; si el motor igual rechaza la compra: `Notice` con el mismo texto |
| Comprado (sobre) | fila al 0,7, "Comprado"; el sobre ya se abrió y la hoja salió | fila |
| Comprado (vale) | igual; la píldora aparece en "Tus vales" y un `Notice` dice "Vale comprado: +1 mano" | fila + aviso |
| Sobre abierto al reabrir la app | tienda montada con la hoja ya visible, elegidos marcados "Elegido", `picksLeft` en el título | hoja |
| Sin ofertas de vale | sección omitida | — |
| Sobre con menos de 3 opciones (catálogo corto) | la hoja muestra las que haya; el título no cambia | hoja |

## 6. Accesibilidad

- **Roles y etiquetas:** fila de oferta = un elemento de texto accesible (`"{nombre}. {descripción}. {estado}"`) + `PriceButton` (`button`, etiqueta "Comprar {nombre} por ${n}", `disabled` cuando no se puede, con el motivo en `accessibilityHint`). Opción del sobre = `button` con `"{nombre}: {descripción}"` (carta: `"Rey de corazones, Reforzada: +25 fichas al puntuar. Se añade a tu mazo"`), hint "Toca para elegir"; elegida: sufijo ", elegido". Los rótulos de sección y el título de la hoja son `header`.
- **Orden de foco:** tienda: cabecera → … ofertas en el orden de `run.shop` → Renovar → sobres → vale → "Tus vales" → Siguiente ciega. Hoja: título → pack → opciones 1..n → error → Saltar. `Sheet` ya usa `accessibilityViewIsModal`; el foco entra en el título al abrir.
- **Errores:** `pack-error` es región viva `assertive` presente desde el principio con el texto vacío (para que se anuncie al cambiar); "Te faltan $n" es texto, no solo color.
- **Cierre bloqueado:** `Sheet` hoy deja el fondo como botón "Cerrar" aunque `onClose` falte. Para la hoja del sobre el fondo no debe ser accesible ni anunciarse; y se debe comprobar en el A56 que Atrás de Android y el gesto "escapar" de TalkBack no cierran la hoja (si hiciera falta, pasar un `onRequestClose` vacío).
- **Movimiento reducido:** fundidos de 120 ms; sin escalonado, sin pulso de escala (el estado "Elegido" lo comunica); `PriceButton` y filas sin animación propia.
- **Contraste:** `primaryFg` sobre `primary` ≈ 8:1; `muted` sobre `surface` ≈ 7:1; `danger` sobre `surface` ≈ 5:1; el borde de píldora y de fila es decorativo, ningún estado depende de él. Objetivos: `PriceButton` ≥ 80×48; filas del sobre ≥ 80 px de alto.

## 7. Copy es-419 (para `apps/mobile/src/i18n/es.ts`)

Los sobres llevan nombre descriptivo (el tipo de contenido es lo que decide la compra); los vales, nombre de salón de juego + efecto corto. Ninguno coincide con nombres de Balatro.

```ts
export const PACK_TEXTS = {
  pack_joker:      { name: 'Sobre de comodines',   description: 'Comodines nuevos para tu run.' },
  pack_consumable: { name: 'Sobre de consumibles', description: 'Estudios, mejoras y más para tu inventario.' },
  pack_card:       { name: 'Sobre de cartas',      description: 'Cartas con mejora que se suman a tu mazo.' },
};
export const VOUCHER_TEXTS = {
  extra_hand:      { name: 'Mano de gracia',       short: '+1 mano',                  description: 'Una mano más en cada ciega, desde la siguiente.' },
  extra_discard:   { name: 'Descarte de cortesía', short: '+1 descarte',              description: 'Un descarte más en cada ciega, desde la siguiente.' },
  joker_slot:      { name: 'Palco ampliado',       short: '+1 espacio de comodín',    description: 'Un espacio más para tus comodines.' },
  consumable_slot: { name: 'Bolsillo del chaleco', short: '+1 espacio de consumible', description: 'Un espacio más para tus consumibles.' },
  cheap_reroll:    { name: 'Propina al crupier',   short: 'Renovar −$1',              description: 'Renovar la tienda cuesta $1 menos (mínimo $0).' },
  interest_cap:    { name: 'Caja fuerte',          short: 'Interés máx. +$1',         description: 'Tu interés máximo por ronda sube $1.' },
}; // VOUCHER_TEXTS gana `short` respecto al plan; el test de cobertura de la Task 7 lo exige.
// es.shop:
packs: 'Sobres · se abren al comprarlos', voucher: 'Vale · mejora permanente', vouchersOwned: (n: number) => `Tus vales · ${n}`,
packPick: (size: number, picks: number) => `Elige ${picks} de ${size}`,
priceVerb: 'Comprar', buyA11y: (name: string, price: number) => `Comprar ${name} por $${price}`,
noJokerSlot: 'Sin espacio: vende un comodín', noConsumableSlot: 'Sin espacio: usa o vende un consumible',
rerollScope: 'Solo cambia comodines y consumibles', voucherBought: (short: string) => `Vale comprado: ${short}`,
// es.packs:
pick: (n: number, left: number) => (n === left ? `Elige ${n}` : `Elige ${n} (quedan ${left})`),
cardNote: 'Las cartas que elijas se añaden a tu mazo.', taken: 'Elegido', pickHint: 'Toca para elegir',
skip: 'Saltar sobre', skipConfirm: 'Confirmar: saltar sin elegir', skipRest: 'Saltar el resto',
added: (name: string) => `Añadido: ${name}`, cardAdded: (label: string) => `Se añadió a tu mazo: ${label}`,
cardItem: (rank: string, suit: string) => `${rank} de ${suit}`,
errors: { noJokerSlot: 'Ya no tienes espacio para otro comodín. Puedes saltar el resto del sobre.',
          noConsumableSlot: 'Ya no tienes espacio para otro consumible. Puedes saltar el resto del sobre.',
          generic: 'No se pudo elegir. Inténtalo de nuevo.' },
```

## 8. Componentes y tokens

**Se reutilizan:** `Sheet`, `Button` (Renovar, Saltar), `Text`, `DecoRule`, `Notice` + `useTransientNotice`, `useArmed`, `EnhancementBadge` (tamaño `tile`), `SuitIcon`, `JokerRail`/`ConsumableTray` (el riel y la bandeja muestran lo recién elegido), `DeckSheet` ("Ver mazo · N" sube), `consumableErrorText`-style de errores, `OfferCard` (comodín y consumible, sin cambios), `feedback` (`select`, `deal`, `limit`).

**Nuevos mínimos:**

| Componente (archivo) | Props | testID |
|---|---|---|
| `OfferRow` (`roguelike/OfferRow.tsx`) | `title`, `line2`, `description`, `status?`, `tone`, `price`, `sold`, `inactive`, `emphasis?: 'voucher'`, `onBuy`, `index` | `offer-<i>`, `buy-<i>` (por posición en `run.shop`) |
| `PriceButton` (`ui/PriceButton.tsx`) | `price`, `sold?`, `inactive?`, `accessibilityLabel`, `onPress` | `buy-<i>` (lo pasa el padre) |
| `VoucherPills` (`roguelike/VoucherPills.tsx`) | `voucherIds` | `vouchers-owned`, `voucher-pill-<id>` |
| `PackSheet` (`roguelike/PackSheet.tsx`) | `run` | `pack-sheet`, `pack-item-<i>`, `pack-error`, `pack-skip` |
| `PackItemRow` (dentro de `PackSheet.tsx`) | `item`, `taken`, `error`, `onPress` | `pack-item-<i>` |
| `CardFace` (`shared/CardFace.tsx`, extraído de `Tile` de `DeckSheet`) | `card: {rank,suit,enhancement?}`, `size: 'tile'\|'pack'` | los pasa el padre (`deck-card-<id>` se conserva) |

Cambio pequeño en `Sheet`: sin `onClose`, el fondo no es accesible ni anuncia "Cerrar".

**Tokens (adiciones):** `layout.packThumb = { width: 52, height: 72 }`, `layout.priceButton = { minWidth: 80 }`, `layout.packRow = { minHeight: 80 }`. Todo lo demás con tokens existentes. `ShopScreen`: `OfferCard` generalizado solo en lo mínimo (los `testID` no cambian); el Maestro (`buy-0`, `E2E-9`) no se toca.

**A criterio de quien implemente:** curva exacta del pulso, si `PriceButton` se hace con `Pressable` propio o ampliando `Button`, ancho exacto de las píldoras, textos de tipos en la miniatura de consumible.

## 9. Evidencia de terminado

Verificar a **360×640** y **412×915**, texto al **100 %** y **130 %**, con **reducir movimiento** activado.
- [ ] Tienda con siete ofertas: el vale se alcanza con ≤3 desplazamientos; ningún texto se corta; Renovar queda bajo Consumibles con su rótulo.
- [ ] Filas de sobre y vale: normal, "Te faltan", "Sin espacio" (comodines 5/5, consumibles 2/2), comprado; la descripción comprada sigue legible (≥4,5:1).
- [ ] Hoja con 1, 2 y 3 opciones, cada tipo (comodín, consumible, carta con mejora), "Elegido", error "sin espacio" visible con la hoja abierta, scroll a 130 %.
- [ ] Sin forma de cerrar la hoja: toque en el fondo, Atrás de Android y gesto de TalkBack no la cierran; Saltar con dos toques si no se eligió nada.
- [ ] Cerrar la app con un sobre abierto (con y sin elecciones hechas) y reabrir.
- [ ] `vouchers-owned` oculta con 0 vales, con 1 y con 6; las píldoras a 130 % hacen salto de línea sin cortarse.
- [ ] TalkBack: orden de foco de §6, etiquetas con nombre + descripción, anuncio del error.

## 10. Decisiones clave a revisar

1. **Filas compactas solo para sobres y vale** (~74 px vs ~150), dejando comodines/consumibles como en la 5a.
2. **Renovar sube** bajo Consumibles con el rótulo "Solo cambia comodines y consumibles".
3. **Botón de precio de dos líneas** ("Comprar" sobre "$6") en vez de "Comprar $6" en una línea; requiere `PriceButton` nuevo.
4. **Vales comprados = píldoras no tocables con el efecto corto, al final del scroll** (no arriba, no tocables).
5. **Elegir en el sobre es un toque, sin confirmar; Saltar sin haber elegido pide dos toques.** Afecta al test de `pack-skip` (hoy un toque).
6. **El error "sin espacio" es texto persistente `pack-error`, no un `Notice`** de 2,5 s, y no manda a vender (la tienda está bloqueada): solo el caso multi-elección.
7. **La carta del sobre usa `CardFace` extraído de `DeckSheet`, no `PlayingCard`**, que cambia el plan de la Task 9.
8. **Nombres:** sobres descriptivos; vales de salón de juego (Mano de gracia, Descarte de cortesía, Palco ampliado, Bolsillo del chaleco, Propina al crupier, Caja fuerte); `VOUCHER_TEXTS` suma `short`.
9. **Supuesto:** el texto del vale `interest_cap` asume interés en dólares (hoy tope $4 → $5); `Sheet` necesita un ajuste de accesibilidad sin `onClose`.
