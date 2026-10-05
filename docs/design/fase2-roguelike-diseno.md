# Fase 2 — Diseño del Modo Roguelike

Estado: **aprobado el 2026-10-03 — dirección B "Gran Salón"**. Producido siguiendo el modo DISEÑAR de `disenador-ui-ux`. Los tokens implementados viven en `apps/mobile/src/theme/tokens.ts` (ADR 0007); la sección 3 muestra la variante A como referencia de estructura, los valores reales son los de B. Ajuste de contraste al implementar: el rubí de mult pasó de `#D1495B` a `#E0606F` para llegar a 5,2:1 sobre el fondo con texto chico.

## 0. Lente del producto

- **Usuario + trabajo:** jugador casual de Latinoamérica que, en una pausa corta, elige de 1 a 5 cartas de su mano para superar el puntaje objetivo de la ciega, con una sola mano y a veces con datos móviles (el roguelike no los usa).
- **Objeto de primera lectura:** cuánto le falta: puntaje actual contra objetivo. Segundo: qué mano está armando con lo seleccionado (tipo de mano + fichas × mult).
- **Acción primaria:** tocar cartas para seleccionarlas y pulsar **Jugar mano**.
- **Frecuencia:** seleccionar / jugar / descartar se repite cada pocos segundos (decenas de veces por sesión). Raro pero riesgoso: vender un comodín sin querer, abandonar la run, gastar el último descarte.
- **Contexto:** Android de gama media, vertical, pulgar derecho o izquierdo, pantalla de 360 px de ancho como mínimo, a veces al sol (contraste alto) y con el volumen apagado (el sonido nunca lleva información única).

## 1. Contrato de diseño — Pantalla de juego

```
Usuario + trabajo: jugador casual; elegir cartas y jugarlas para superar el objetivo de la ciega.
Objeto de primera lectura: puntaje actual vs objetivo (número grande + barra).
Acción primaria: Jugar mano (botón grande, zona del pulgar, abajo a la derecha).
Densidad: compacta. Todo el estado de decisión cabe sin scroll a 360×640.
Jerarquía: puntaje/objetivo → mano seleccionada (tipo + fichas × mult) → mano de cartas y
  botones → comodines → soporte (nivel/ciega, dinero, mazo restante, regla del jefe).
Modelo de interacción: tablero con selección múltiple (tocar = seleccionar/deseleccionar) + 2 acciones.
Prioridad responsive (solo vertical): 360 px es el diseño base; en pantallas más anchas las
  cartas crecen hasta 72 px y se reduce el solape; en pantallas bajas (< 680 px útiles) la zona
  central se encoge primero, nunca la mano ni los botones.
Referencias (lección transferible, sin copiar estilo):
  - Solitarios móviles (p. ej. Microsoft Solitaire): índice de esquina legible aunque la carta
    esté solapada → el rango y el palo van en la esquina superior izquierda, lo único siempre visible.
  - Slay the Spire (móvil): mostrar el resultado de la jugada antes de confirmarla → vista previa
    del tipo de mano y fichas × mult al seleccionar.
  - Hearthstone: la tarjeta en mano se levanta al seleccionarla → feedback de selección por
    posición, no solo por color.
  - Apps de banca LatAm (Nubank, Mercado Pago): número protagonista con separador de miles
    local → "12.450" y "$12".
Defaults prohibidos:
  - Imitar Balatro: fondo animado psicodélico, tipografía pixel, cajas gemelas azul/roja de
    fichas y mult, layout de columna lateral izquierda con la info de la ciega.
  - Mesa de fieltro verde genérica de casino.
  - Botones idénticos para Jugar y Descartar (deben diferir en peso y posición).
  - Palo comunicado solo por color.
Evidencia de terminado: estados (seleccionando 0/1–5, vista previa, puntuando, ciega ganada,
  run perdida, jefe activo, sin descartes) a 360×640 y 412×915, con texto del sistema al 100 % y 130 %,
  y con "reducir movimiento" activado.
```

### Layout a 360 px (alto útil de referencia 720 px, de arriba abajo)

| Zona | Alto | Contenido |
|---|---|---|
| Barra de estado de la ciega | 48 | "Nivel 2 · Ciega grande" (o nombre del jefe) a la izquierda; dinero "$12" a la derecha. Si es jefe: chip con la regla debajo ("Las picas no puntúan"). |
| Bloque de puntaje | 72 | "1.240" grande (numérico 32) + "de 1.800" + barra de progreso de 8 px. |
| Fila de comodines | 88 | 5 espacios de 58×80 (vacíos con borde punteado). Tocar = ver detalle. Mantener 250 ms = levantar y arrastrar para reordenar. |
| Zona de jugada (flexible) | ≥ 120 | Sin selección: "Elige hasta 5 cartas". Con selección: tipo de mano + nivel ("Par · nv 2") y la ecuación "24 fichas × 3 mult". Al jugar, las cartas viajan aquí y se cuentan. |
| Mano | 124 | 8 cartas de 60×84 en abanico; seleccionada = sube 16 px + borde de acento. Contador "Mazo 36" a la derecha, encima. |
| Ordenar | 40 | Segmentado "Valor · Palo". |
| Acciones | 64 | [Descartar · 3] secundario (40 %) a la izquierda, [Jugar mano · 4] primario (60 %) a la derecha, 56 px de alto. El contador va dentro del botón: la cantidad está donde se decide. |

Suma fija ≈ 484 px + zona flexible. A 360×640 la zona de jugada queda en ~120 px.

**Cartas en abanico:** con 8 cartas de 60 px en 328 px útiles, cada carta deja ver 38 px. El índice de esquina (rango + palo) mide 30 px de ancho, así que siempre se lee. El área táctil de cada carta es su franja visible (38 × 84 px, más 16 px de margen arriba cuando está levantada), por encima del mínimo AA de 24 px. Con 5 cartas o menos en mano no hay solape.

### Componentes y estados

| Componente | Estados |
|---|---|
| `PlayingCard` | normal · seleccionada (sube + borde 2 px de acento + `accessibilityState.selected`) · deshabilitada (6.ª carta cuando ya hay 5: no sube y vibra corto) · debilitada por jefe (rayado diagonal + ícono de candado, no solo gris) · puntuando (pulso) · no puntúa (40 % de opacidad durante el conteo) |
| `JokerSlot` | vacío · ocupado · activándose (sacudida + etiqueta "+4 mult") · levantado para arrastrar · en tienda: con precio de venta |
| `ScoreHeader` | normal · ciega superada (barra completa + check) · número grande (notación "1,2e9" a partir de mil millones) |
| `HandPreview` | sin selección (pista) · selección válida (tipo + ecuación) · puntuando (la ecuación se va actualizando) |
| `ActionBar` | Jugar deshabilitado sin selección (se mantiene visible, con pista "Elige cartas") · Descartar sin descartes: muestra "Sin descartes" y no responde · ocupado durante la animación |
| `ShopItem` | disponible · sin dinero (precio en rojo + "Te faltan $2") · comprado · sin espacio ("Comodines llenos") |

### Otras pantallas del flujo

1. **Inicio:** "Continuar run" (si hay una guardada, primario) · "Nueva run" · "Jugar con semilla".
2. **Juego** (contrato de arriba).
3. **Ciega superada** (hoja inferior): recompensa por ciega + interés + bono por manos sobrantes, con los montos línea por línea y el total; botón "Ir a la tienda".
4. **Tienda:** 2 comodines + 2 consumibles; "Renovar ($3)" con costo creciente; tocar un comodín propio → "Vender ($2)" con confirmación en el mismo botón (dos toques) para evitar ventas accidentales; "Siguiente ciega".
5. **Fin de run:** ganada o perdida, nivel alcanzado, mejor mano, **semilla visible** con "Copiar semilla" y botones "Nueva run" / "Repetir semilla".
6. **Jugar con semilla:** campo de texto (placeholder "LUNA-42"), botón "Empezar".
7. **Detalle de comodín** (hoja): nombre, efecto en una frase, precio de venta si aplica.
8. **Niveles de mano** (desde la barra superior): tabla tipo de mano → nivel, fichas, mult.

**Errores y casos raros:** no hay red en este modo, así que no hay estados offline. Si falla cargar la run guardada (versión incompatible o datos corruptos): "No pudimos recuperar tu run anterior. Puedes empezar una nueva." con botón "Nueva run" (la run dañada se descarta, no se muestra un stack).

## 2. Tres direcciones visuales

Las tres son de fondo oscuro, usan cartas claras (mejor contraste para los índices) y una **baraja de 4 colores**: cada palo tiene su color **y** su símbolo, así el palo nunca depende solo del color.

### A. Verbena (recomendada)
- **Concepto:** fiesta de pueblo de noche: cielo índigo, tiras de papel picado como marco, cartas de papel crema con esquinas de estampa.
- **Paleta:** fondo índigo noche `#15183A` · superficie `#20244D` · texto crema `#F7EEDC` · primario cempasúchil `#F2A33A` · mult rosa mexicano `#E8467C` · fichas turquesa `#35B6C9` · dinero oro `#F5C84B`.
- **Palos sobre crema:** ♠ tinta `#1C1A2E` · ♥ granada `#C8233F` · ♦ añil `#1A5E9A` · ♣ nopal `#276B43`.
- **Tipografía:** Fraunces (títulos y tipo de mano; serif con carácter, licencia OFL) + Rubik (UI y números tabulares, OFL).
- **Motivo de las cartas:** pips con muescas triangulares de papel recortado; dorso con calado de papel picado; comodines como "estampas" ilustradas.
- **Por qué la recomiendo:** es la única de las tres con identidad latinoamericana inmediata, coherente con el público objetivo, y queda lejos del estilo de Balatro. El papel picado es un patrón estático (SVG o imagen), así que no cuesta frames. **Riesgo:** puede leerse como muy mexicana; se mitiga usando el papel picado solo en marcos y dorsos, no en todos lados.

### B. Gran Salón
- **Concepto:** salón de baile art déco de los años 20: líneas doradas finas, geometría escalonada, marfil sobre verde casi negro.
- **Paleta:** fondo `#0E1714` · superficie `#16231F` · texto marfil `#F1EBDD` · primario latón `#C9A35A` · mult rubí `#D1495B` · fichas jade `#4FB3A1` · dinero `#E7C873`.
- **Tipografía:** Big Shoulders Display (títulos condensados, OFL) + Barlow (UI y números, OFL).
- **Motivo:** marco de doble filete con esquinas escalonadas; pips con rayos de sol; dorso con abanico déco.
- **Riesgo:** elegante pero más fría y cercana a la estética de casino; menos distintiva para el público casual.

### C. Mercado Riso
- **Concepto:** afiche impreso en risografía para un mercado: dos tintas planas con un leve desfase de registro, frutas y formas simples.
- **Paleta:** fondo petróleo `#0F2A2E` · superficie `#173A3F` · texto papel `#FFF3E2` · primario girasol `#FFC53D` · mult rosa flúor `#FF5C8A` · fichas menta `#6FE0C4` · dinero `#FFC53D`.
- **Tipografía:** Archivo (Black para títulos, Regular/Medium para UI, OFL).
- **Motivo:** sombra desfasada de 2 px en rosa bajo la tinta de cada carta; pips planos con textura de trama de puntos.
- **Riesgo:** muy juguetona; la trama y el desfase exigen cuidado para no ensuciar los índices a 60 px.

## 3. Tokens (dirección A; B y C cambian solo los valores de color y las familias tipográficas)

Contrastes verificados (WCAG 2.2): texto crema sobre fondo ≈ 15:1; `muted` sobre fondo ≈ 8:1; rosa mult sobre fondo ≈ 4,8:1; turquesa sobre fondo ≈ 6,9:1; texto del botón primario sobre cempasúchil ≈ 9:1; palos sobre carta crema: granada ≈ 5,0:1, añil ≈ 5,8:1, nopal ≈ 5,4:1, tinta ≈ 15:1.

```ts
// apps/mobile/src/theme/tokens.ts — dirección A "Verbena"
export const colors = {
  bg: '#15183A',
  surface: '#20244D',
  surfaceRaised: '#2B3063',
  fg: '#F7EEDC',
  muted: '#B9B3CF',
  border: '#3A3F75',
  primary: '#F2A33A',      // Jugar mano, CTA de cada pantalla
  primaryPressed: '#D98B22',
  primaryFg: '#2A1700',
  secondary: '#2B3063',    // Descartar y acciones secundarias
  secondaryFg: '#F7EEDC',
  chips: '#35B6C9',
  mult: '#E8467C',
  money: '#F5C84B',
  success: '#5CC98A',
  danger: '#FF6B5E',
  focus: '#F5C84B',
  card: { face: '#F7EEDC', ink: '#1C1A2E', edge: '#D9CDB3', back: '#E8467C' },
  suit: { s: '#1C1A2E', h: '#C8233F', d: '#1A5E9A', c: '#276B43' },
  overlay: 'rgba(8, 9, 28, 0.72)',
} as const;

export const fonts = {
  display: 'Fraunces_700Bold',
  displayItalic: 'Fraunces_600SemiBold_Italic',
  ui: 'Rubik_400Regular',
  uiMedium: 'Rubik_500Medium',
  uiBold: 'Rubik_700Bold',
} as const;

/** Tamaños en px a escala de texto 1.0. Respetan el tamaño de texto del sistema (allowFontScaling). */
export const typography = {
  display: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34 },
  title: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28 },
  subtitle: { fontFamily: fonts.uiMedium, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: fonts.ui, fontSize: 16, lineHeight: 22 },
  caption: { fontFamily: fonts.ui, fontSize: 13, lineHeight: 18 },
  button: { fontFamily: fonts.uiBold, fontSize: 18, lineHeight: 22 },
  scoreXL: { fontFamily: fonts.uiBold, fontSize: 32, lineHeight: 38, fontVariant: ['tabular-nums'] },
  numeric: { fontFamily: fonts.uiMedium, fontSize: 18, lineHeight: 22, fontVariant: ['tabular-nums'] },
  cardIndex: { fontFamily: fonts.display, fontSize: 18, lineHeight: 20 }, // maxFontSizeMultiplier 1.2
} as const;

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radii = { sm: 6, md: 10, lg: 16, card: 6, pill: 999 } as const;
export const elevation = { card: 2, raised: 6, sheet: 12 } as const; // Android elevation
export const touchTarget = 48; // mínimo propio (AA exige 24; recomendado 44–48)

export const layout = {
  gutter: 16,
  card: { width: 60, height: 84, minVisible: 38, lift: 16 },
  jokerSlot: { width: 58, height: 80, count: 5 },
  actionBarHeight: 56,
} as const;

export const motion = {
  duration: { instant: 0, fast: 120, base: 220, slow: 300, scoreStep: 220, scoreStepMin: 90 },
  easing: {
    out: [0.22, 1, 0.36, 1],      // easeOutQuint: entradas (repartir, subir carta)
    inOut: [0.65, 0, 0.35, 1],    // easeInOutCubic: traslados (jugar)
    in: [0.55, 0, 1, 0.45],       // easeInCubic: salidas (descartar)
  },
  spring: { damping: 18, stiffness: 220, mass: 1 }, // reordenar comodines
  stagger: { deal: 40, play: 50, discard: 30 },
} as const;
```

Paletas B y C para el mismo esquema de claves: ver la sección 2 (los colores de palo se mantienen en las tres: ♠ tinta, ♥ rojo, ♦ azul, ♣ verde).

## 4. Animaciones clave

Todas solo con `transform` y `opacity`, en el hilo de UI (Reanimated). Sin re-render de React por frame. Con **reducir movimiento** (`useReducedMotion` de Reanimated) se reemplazan por la variante indicada.

| Animación | Qué pasa | Duración / easing | Reducir movimiento | Háptica |
|---|---|---|---|---|
| Repartir | Cada carta va del mazo (abajo a la derecha) a su lugar en el abanico, con rotación de −6° a su ángulo final | 220 ms `out`, escalonado 40 ms (8 cartas ≈ 500 ms) | Aparecen con fundido de 120 ms, todas juntas | — |
| Seleccionar | La carta sube 16 px y escala a 1,04; borde de acento | 120 ms `out`; deseleccionar 100 ms | Sube sin animación (el cambio de posición es información, no adorno) | Toque leve (`selectionAsync`) |
| Jugar | Las seleccionadas viajan a la zona de jugada; las que no puntúan bajan a 40 % de opacidad | 260 ms `inOut`, escalonado 50 ms; atenuado 150 ms | Aparecen directamente en la zona de jugada | Impacto medio al pulsar |
| Contar puntaje | Por cada paso del engine: la carta o comodín pulsa (escala 1→1,12→1), sube una etiqueta "+11" que se desvanece, y el contador correspondiente se actualiza | Paso de 220 ms (pulso 90+90 ms `out`, etiqueta 400 ms); si hay muchos pasos, el paso se acorta hasta 90 ms para que el total no pase de ~2,5 s. Tocar la pantalla salta al resultado | Sin pulsos ni etiquetas que suben: los números cambian paso a paso cada 120 ms | — |
| Resultado | El total (fichas × mult) cuenta hacia arriba y la barra de progreso se llena | 400 ms `out` + 300 ms barra | Número final directo | Impacto fuerte si supera el objetivo |
| Activar comodín | Sacudida de ±6° (2 ciclos) + escala 1,1 + etiqueta "+4 mult" / "×1,5 mult" | 240 ms | Destello del borde (150 ms de opacidad) | Impacto leve (+mult) o rígido (×mult) |
| Descartar | Las cartas caen fuera de la pantalla y se reparten las nuevas | 200 ms `in`, escalonado 30 ms | Fundido 120 ms | — |
| Reordenar comodines | Mantener 250 ms levanta (escala 1,08, elevación); el resto se corre con resorte | resorte `damping 18 / stiffness 220` | Igual, sin escala | Toque leve al levantar |
| Ciega superada | Hoja inferior con el desglose de dinero | 280 ms `out` | Fundido 120 ms | — |

**Presupuesto de rendimiento:** a 60 fps en gama media, como máximo 13 vistas animadas a la vez (5 cartas + 5 comodines + 3 contadores). Las etiquetas flotantes salen de un pool fijo, sin crear vistas nuevas durante el conteo. Si en el dispositivo bajamos de ~50 fps, el plan B es el disparador del ADR 0002 (dibujar la mesa con Skia).

## 5. Accesibilidad

- Palo = símbolo + color (4 colores) en el índice y en los pips. Las cartas debilitadas por el jefe usan rayado + ícono de candado, no solo gris.
- Lector de pantalla: cada carta se anuncia como "As de corazones, seleccionada"; el puntaje como "1.240 de 1.800"; la vista previa como "Par, 24 fichas por 3 de multiplicador".
- Objetivos táctiles: botones de 56 px de alto; espacios de comodín de 58×80; cartas con franja visible ≥ 38 px.
- Texto del sistema: todo el texto escala (`allowFontScaling`). Índices de carta y números dentro de las cartas con `maxFontSizeMultiplier` 1.2 porque la carta tiene tamaño fijo. A 130 % se verifica que la barra de acciones y el bloque de puntaje no se corten.
- El sonido nunca es la única señal: todo efecto sonoro tiene su equivalente visual.

## 6. Copy (es-419)

Botones: "Jugar mano", "Descartar", "Ir a la tienda", "Renovar ($3)", "Vender ($2)", "Siguiente ciega", "Continuar run", "Nueva run", "Jugar con semilla", "Copiar semilla", "Repetir semilla". Pistas: "Elige hasta 5 cartas", "Sin descartes", "Te faltan $2", "Comodines llenos". Ciegas: "Ciega chica", "Ciega grande" y el nombre del jefe. Todo en `apps/mobile/src/i18n/es.ts`.

## 7. Hand-off

- Tokens en `apps/mobile/src/theme/tokens.ts`; primitivas `Text`, `Button`, `Screen` que solo aceptan tokens (ADR 0007).
- Nombres de componentes: `PlayingCard`, `HandFan`, `JokerRail`, `JokerSlot`, `ScoreHeader`, `HandPreview`, `ActionBar`, `ShopItem`, `RoundWonSheet`, `RunOverScreen`.
- Fuentes con `@expo-google-fonts/fraunces` y `@expo-google-fonts/rubik` (licencia OFL); verificar `tabular-nums` en Android con Rubik y, si no se aplica, caer a un ancho fijo por dígito.
- A criterio del implementador: ilustraciones de los comodines (placeholder geométrico por rareza en el MVP), sonidos (placeholders con licencia CC0 anotada), el ángulo exacto del abanico.
