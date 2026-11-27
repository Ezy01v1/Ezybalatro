# Fase 5b — Sobres y vales (diseño)

Fecha: 2026-11-27 · Estado: **pendiente de aprobación del usuario** · Base: [Fase 5, §5b](2026-11-24-fase5-roguelike-profundidad-design.md) (aprobada) · Rama: `feat/phase-5b-packs-vouchers`, apilada sobre `feat/phase-5a-consumables` (PR 1 abierto, aún sin mergear).

> Lo marcado **[mi decisión]** es una propuesta de Claude, no algo que el usuario haya aceptado. El usuario dijo "nada que corregir de la 5a, sigue con la 5b" y dejó el resto a criterio de Claude. No se hizo la revisión con un subagente "constructor": la leyó el propio autor como si fuera quien implementa (la fase es una subfase de un diseño ya aprobado).

## 1. Intención

Hoy la tienda ofrece 2 comodines y 2 consumibles, y lo que compras es solo para esa run. Faltan dos tipos de decisión que hacen distinta una run:

- **Sobres:** pagar por abrir un paquete y **elegir** entre varias opciones (un riesgo pequeño que se siente como botín).
- **Vales:** mejoras **permanentes de las reglas de la run** (más manos, más descartes, más espacios, renovar más barato, más interés). Hacen que ahorrar dinero y planear la tienda importen.

Éxito: en una tienda típica el jugador tiene al menos 2–3 decisiones de construcción reales (comprar comodín / consumible / sobre / vale, renovar o ahorrar para interés), y dos runs con semillas distintas no se parecen.

## 2. Metas, no-metas y anti-metas

**Metas**
- Sobres y vales son **contenido como datos** (`content.ts`); el reducer tiene un solo intérprete de cada cosa, sin `if` por id.
- Determinista y reproducible por semilla (`replayRun`); la semilla `E2E-9` de Maestro (oferta 0 = comodín `minimalist`) sigue dando lo mismo.
- Funciona sin red, a 360 px, con una mano.
- Si la app se cierra con un sobre abierto, al volver sigue abierto (el estado vive en la run guardada).

**No-metas (más adelante)**
- Etiquetas y saltar ciega (5e), ediciones/repeticiones (5c), más comodines/jefes (5d), rebalanceo fino (5f).
- Sobres "mega", sobres que se guardan para abrir después, vales de dos niveles (versión mejorada de otro vale), rarezas ponderadas.
- Vender sobres o vales; `grantMoney` (5f).

**Anti-metas**
- Una tienda que no se entienda en 360 px (la tienda pasa de 4 a 7 ofertas).
- Que el azar nuevo desplace lo que ya sortea la tienda (rompería semillas guardadas y el e2e).
- Que un vale o sobre requiera lógica repartida por el reducer.

## 3. Restricciones del código actual (verificado)

- `rollOffers` (`run.ts`) sortea con el sub-stream `shop`: primero comodines, luego consumibles. **No se puede cambiar ese orden** ni consumir más del stream `shop` antes de ellos.
- `RunState.rng` tiene `deck`, `shop`, `boss`; agregar `pack` obliga a subir `RUN_STATE_VERSION` a **3** (las runs guardadas con la 2 se descartan, ya existe el aviso).
- `ShopOffer` es `joker | consumable`; la UI y los `testID` usan la posición en `run.shop` (`offer-<i>`, `buy-<i>`). Los comodines y consumibles deben seguir en las posiciones 0 a 3.
- `RunConfig` viaja dentro de `RunState` y es solo números: un vale puede **modificar `state.config`** al comprarse. El log de la run guarda la config base y las acciones; al reproducir se vuelve a comprar el vale y se vuelve a aplicar. Es consistente.
- `startBlind` lee `config.hands`, `discards`, `handSize` al empezar cada ciega; `openShop` y `reroll` leen `rerollBaseCost`; el cierre de ronda lee `interestCap`.
- Las cartas nuevas del mazo usan `nextCardNumber` (ids `x<n>`, igual que `duplicateCard`).
- La tienda de la app ya agrupa por secciones y es un `ScrollView`; el botón "Siguiente ciega" está en un pie fijo.

## 4. Enfoques considerados

**A. Sobre = oferta de tienda que se abre al comprarla [elegido, mi decisión].** Comprar la oferta cobra el precio y abre el sobre al instante: `RunState.openPack` guarda las opciones y cuántas elecciones quedan; hasta elegir o saltar, la tienda queda bloqueada. Un estado, tres acciones, sin inventario nuevo. Es lo que dice el diseño de la Fase 5.

**B. Sobre = ítem del inventario que se abre cuando quieras.** Más decisiones (guardarlo, abrirlo en una ciega), pero compite por los 2 espacios de consumible, exige otro tipo de ítem y más UI. Se descarta para el MVP.

**C. Vale como gancho evaluado en cada punto de uso** (como un comodín): flexible, pero obliga a pasar los vales por el cálculo de puntaje y por el reducer. Los vales de la 5b solo cambian números de la config. **Elegido: modificar la config al comprarlos** (más simple, reproducible, sin ganchos). Si en el futuro un vale necesitara un efecto que no sea un número de la config, se añade un gancho entonces.

**Sobre el renovar [mi decisión]:** renovar vuelve a sortear **solo comodines y consumibles**; los sobres y el vale se quedan (con su estado de comprados). Si renovar también los cambiara, el jugador podría "pescar" el vale que quiere y el vale podría desaparecer.

## 5. El diseño

### 5.1 Motor

**Tipos (`types.ts`)**
```
PackDefinition  { id, cost, kind: 'joker' | 'consumable' | 'card', size, picks }
VoucherDefinition { id, cost, modifiers: readonly { key: ModifiableConfigKey, delta: number }[] }
ModifiableConfigKey = 'hands' | 'discards' | 'jokerSlots' | 'consumableSlots'
                    | 'rerollBaseCost' | 'interestCap'
PackItem = { kind: 'joker', jokerId } | { kind: 'consumable', consumableId }
         | { kind: 'card', suit, rank, enhancement }   // el id se asigna al elegirla
RunContent gana: packs, vouchers
```

**Estado (`RunState`)**: `vouchers: string[]` (ids comprados), `openPack: { packId, items: (PackItem & { taken: boolean })[], picksLeft } | null`, `rng.pack`, `nextCardNumber` ya existe. `RUN_STATE_VERSION = 3`.

**Ofertas.** `ShopOffer` gana `{ kind: 'pack', packId, price, sold }` y `{ kind: 'voucher', voucherId, price, sold }`. Orden en `run.shop`: comodines, consumibles, **2 sobres**, **1 vale**. Los sobres y el vale se sortean **al abrir la tienda** con el stream `pack` (sobres distintos entre sí; vale entre los no comprados; si no queda ninguno, no hay oferta de vale). Config nueva: `shopPackOffers: 2`, `shopVoucherOffers: 1`.

**Acciones nuevas**
- `buy` (ya existe) sobre una oferta `pack`: cobra, marca vendida, sortea el contenido con el stream `pack` y deja `openPack`. Se rechaza con `NO_JOKER_SLOT` / `NO_CONSUMABLE_SLOT` si el sobre es de comodines/consumibles y no hay espacio (así no se pierde dinero; para sobres de cartas no hay límite).
- `buy` sobre una oferta `voucher`: cobra, aplica los modificadores a `d.config`, agrega el id a `vouchers`. `rerollBaseCost` también baja el costo de renovar vigente (mínimo 0).
- `pickFromPack { itemIndex }`: el comodín va a un espacio libre (instancia `j<n>`, estado inicial), el consumible al inventario (`c<n>`), la carta se agrega al mazo con id `x<n>` (la tienda no tiene mano, así que entra en el mazo de la siguiente ciega). Falla con `NO_JOKER_SLOT`/`NO_CONSUMABLE_SLOT` sin cambiar nada (el sobre sigue abierto). Cuando `picksLeft` llega a 0, el sobre se cierra.
- `skipPack`: cierra el sobre sin elegir (lo sobrante se pierde).
- Con un sobre abierto, todas las demás acciones de la tienda (`buy`, `reroll`, `leaveShop`, `sellJoker`, `applyConsumable`, `sellConsumable`, `moveJoker`) devuelven `PACK_OPEN`. `pickFromPack`/`skipPack` sin sobre abierto devuelven `NO_PACK_OPEN`; un índice inválido o ya tomado, `INVALID_PACK_ITEM`.

**Contenido de un sobre.** Una sola función con `switch` sobre `kind` (exhaustivo): `joker` = comodines no poseídos y distintos; `consumable` = consumibles distintos; `card` = cartas con palo y valor al azar, **siempre con una mejora** al azar de `content.enhancements`. Si el catálogo tiene menos candidatos que `size`, se ofrecen los que haya.

**Eventos:** `packOpened { packId, items }`, `packPicked { itemIndex }`, `packSkipped`, `voucherBought { voucherId }` (más el `bought` que ya existe).

**Contenido inicial [mi decisión, números iniciales a validar con el simulador]**
- 3 sobres: de comodines (costo 6, 3 opciones, elige 1), de consumibles (4, 3 opciones, elige 1), de cartas (5, 3 opciones, elige 1).
- 6 vales: +1 mano (10), +1 descarte (8), +1 espacio de comodín (10), +1 espacio de consumible (6), renovar −1 (6), tope de interés +1 (8). Nombres en es-419 originales, definidos al implementar.

**Renovar.** `reroll` sustituye solo las ofertas de comodín y consumible; conserva sobres y vale (y si ya se compraron).

### 5.2 App móvil

- La tienda muestra secciones **Comodines, Consumibles, Sobres, Vale** y, aparte, los vales ya comprados (lista corta, para recordar qué reglas cambiaron). `testID` por posición en `run.shop` como hoy.
- **Hoja de apertura de sobre (`PackSheet`)**: se muestra automáticamente cuando `run.openPack` existe (también al reabrir la app). Cartas de las opciones, tocar para elegir, "Saltar" siempre visible, texto "Elige 1" / "Elige N (quedan M)", error visible si no hay espacio. No se puede cerrar la hoja sin elegir o saltar (la tienda está bloqueada de todos modos).
- El store de Zustand envuelve las acciones nuevas; la UI no calcula reglas.
- **Antes de implementar la pantalla** se pide a `disenador-ui-ux` el diseño (siete ofertas en 360 px, hoja del sobre, vales comprados) en `docs/design/fase5b-sobres-vales-diseno.md` y se aprueba, igual que en la 5a.

### 5.3 Simulador

`simulate-balance.mjs` gana una política mínima [mi decisión]: compra el vale si le alcanza con una reserva de $5 (prefiere +mano, +descarte), y abre el sobre de comodines cuando le alcanza, eligiendo el primer comodín que le sirva. Es informativa: la meta de la 5b **no** es un porcentaje de victorias, sino que el simulador corra sin errores y que el resultado se registre; el ajuste fino de precios es de la 5f.

## 6. Pruebas
- Engine: contenido válido (ids únicos, costos > 0, `size ≥ picks`), apertura de sobre determinista, elegir/saltar, bloqueo con sobre abierto, vales que modifican la config (y su efecto: mano, descarte, espacios, interés, renovar), no repetir vale, renovar conserva sobres y vale, `replayRun` con sobres y vales, propiedad `fast-check` ampliada (nunca se excede espacio, dinero ≥ 0, cada carta única), guardado/carga en la versión 3.
- Móvil: tienda con siete ofertas, flujo comprar sobre → elegir → cierra, saltar, error sin espacio, run guardada con sobre abierto reabre la hoja.
- Maestro: el flujo existente (`buy-0`, semilla `E2E-9`) no debe cambiar.

## 7. Lo que queda a criterio de quien construya
Nombres definitivos en es-419 de sobres y vales; costos finales (los ajusta el simulador y la 5f); forma exacta de la hoja del sobre y de la lista de vales comprados (la propone el agente de UI); dónde reutilizar `PlayingCard`/`JokerCard` en la hoja.

## 8. Preguntas abiertas (del usuario, heredadas de la Fase 5)
Siguen sin responder las 4 de la Fase 5 §7 (qué debe sentir el jugador, meta de dificultad, duración de una run, entregas intermedias). La 5b no depende de ellas.
