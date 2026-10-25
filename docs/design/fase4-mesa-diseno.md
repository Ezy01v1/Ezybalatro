# Fase 4b — Diseño del Modo Mesa y del menú principal

Fecha: 2026-10-21 · Estado: **aprobado** por el usuario (2026-10-24)
Alcance: **solo diseño** (sin código). Lo implementan la 4a (mesa conectada al servidor) y la 4c (menú y cuenta). El perfil y borrar cuenta se diseñan en la 4c.
Dirección visual: **B "Gran Salón"** (Fase 2, `docs/design/fase2-roguelike-diseno.md`), tokens existentes en `apps/mobile/src/theme/tokens.ts`.
Wireframes de referencia (abrir en el navegador): `docs/design/fase4/wireframe-mesa.html` (opción A) y `docs/design/fase4/wireframe-menu.html` (opción A).

## 0. Lente del producto

- Jugador casual latinoamericano, sesiones cortas, **una mano**, a veces con datos móviles y con el servidor gratuito que puede estar dormido (~1 min para despertar, ADR 0009).
- Lo que más se repite en la mesa: **mirar si es mi turno → decidir → apostar un monto**. Eso tiene que ser obvio y estar al alcance del pulgar.
- Lo raro pero de alto riesgo: perder la conexión con fichas en el bote, el servidor que se reinicia (la mesa se cierra y las fichas vuelven al wallet).
- El servidor es la única autoridad: la UI **nunca calcula reglas**; muestra la vista del asiento (`viewFor`) y los montos válidos que manda el servidor (`legalActions`).

## 1. Contrato de diseño — Pantalla de la mesa

**Disposición elegida: óvalo clásico** (mesa vista desde arriba, rivales alrededor, tú abajo).

### Layout a 360 px (alto útil de referencia 720 px, de arriba abajo)

| Zona | Alto aprox. | Contenido |
|---|---|---|
| Barra superior | 44 | ⋮ (menú de mesa) a la izquierda · "Ciegas 10/20" al centro · tu saldo de wallet a la derecha (`money`) |
| Óvalo y rivales | ~400 | Paño `surface` con filete `primary` al 40 %. Hasta **5 rivales** en posiciones fijas: arriba al centro, laterales altos (2), laterales bajos (2). Centro del óvalo: board + bote |
| Tu zona | ~130 | Tus 2 cartas grandes, tu apodo y stack, tu temporizador cuando es tu turno, tu apuesta de la calle |
| Barra de acción | ~110 | Rápidos de monto (si está abierto Subir) + 3 botones de acción de 48 dp mínimo |

- Posiciones: el asiento propio siempre abajo al centro; los demás se rotan para que el orden de la mesa se respete en sentido horario.
- Asientos vacíos: círculo punteado `border` con "Libre" (`muted`). No se pueden tocar en el MVP (la mesa rápida te sienta sola).
- Márgenes laterales 12 px; nada interactivo a menos de 8 px del borde.

### Componentes y estados

**Asiento de rival (`SeatBadge`)** — avatar 44 px (inicial del apodo sobre `surfaceRaised` hasta que haya avatares en la 4c), apodo (1 línea, recortado), stack (`numeric` pequeño, `money`).

| Estado | Señal visual | Lector de pantalla |
|---|---|---|
| Esperando | normal | "Rita, 1.240 fichas" |
| Su turno | anillo `chips` alrededor del avatar que se vacía con el tiempo (20 s); últimos 5 s en `mult` con latido suave | "…, su turno" |
| Retirado | opacidad 40 %, cartas fuera | "…, se retiró" |
| All-in | etiqueta "TODO" en `primary` | "…, todo adentro" |
| Sentado fuera | etiqueta "Fuera" en `muted`, opacidad 60 % | "…, sentado fuera" |
| Desconectado | ícono de señal tachada sobre el avatar | "…, desconectado" |
| Ganador | halo `money` + monto ganado "+320" | "…, gana 320" |

**Marcas por asiento:** botón "D" (ficha marfil con letra `primaryFg`) junto al asiento del botón; apuesta de la calle actual como pila de fichas `chips` + número, entre el asiento y el centro. Ciegas: la apuesta inicial se ve igual que cualquier apuesta.

**Centro del óvalo:**
- Board: 5 espacios de carta (tamaño medio). Las que no salieron muestran el dorso déco (`card.back` con filete `card.edge`).
- Bote: "Bote 320" (`money`, `numeric`). Con botes laterales: "Bote 320 · Lateral 140 · Lateral 60" (si no entra en una línea, dos líneas centradas).
- Nombre de la mano en el showdown, sobre el board ("Escalera, al 9").

**Tu zona (`HeroSeat`):** tus 2 cartas grandes (las mismas `PlayingCard` del roguelike en tamaño grande), apodo, stack, apuesta de la calle. Tu turno: anillo temporizador alrededor del área de cartas + realce `primary` en la barra de acción.

**Barra de acción (`ActionBar`)** — siempre en el mismo lugar; los botones cambian de texto, no de posición:

| Situación | Izquierda | Centro | Derecha |
|---|---|---|---|
| No es tu turno | "Esperando a Sol…" a lo ancho, sin botones activos | | |
| Tu turno, sin apuesta que igualar | Retirarse | **Pasar** | Apostar |
| Tu turno, con apuesta que igualar | Retirarse | **Pagar 40** | Subir |
| Igualar te deja sin fichas | Retirarse | **Pagar todo (180)** | — (oculto) |
| Fuera de la mano / sentado fuera | "Volver a la mesa" (sitIn) a lo ancho | | |

- **Apostar/Subir** abre el **selector de monto** encima de la barra: rápidos **Mín · ½ bote · Bote · Todo** (chips `chips`), slider de mínimo a todo tu stack, botones **−** y **+** (paso = ciega grande), el monto grande arriba (`scoreXL`, `money`) y el botón de confirmación **"Subir a 120"** / **"Apostar 60"** (`primary`). Tocar fuera o "Cancelar" lo cierra.
- Los rápidos que no son válidos (p. ej. ½ bote menor que el mínimo) se muestran deshabilitados; el slider y los botones nunca permiten un monto fuera de `legalActions` (mín. de subida, stack).
- "Todo" pide confirmación con un segundo toque ("Toca de nuevo para ir con todo").
- Mientras la acción viaja al servidor, la barra se bloquea (sin spinner salvo que tarde > 600 ms).

**Showdown y fin de mano:**
- Las cartas de quienes muestran se voltean en su asiento; al ganador se le resalta el asiento y las 5 cartas que forman su mano (las demás del board se atenúan).
- Perdedores que no muestran: sus cartas no se ven nunca (muck automático, ADR 0008).
- Mano ganada sin showdown: "Sol gana 320" sobre el bote, sin mostrar cartas.
- La siguiente mano empieza sola (`BETWEEN_HANDS_MS`, 3 s); no hay botón "siguiente".

**Menú de mesa (⋮):** "Salir de la mesa" · "Sentarme fuera" / "Volver a la mesa". Salir en medio de una mano pide confirmación: "Si sales ahora, te retiras de esta mano. ¿Salir?" Al salir: resumen "Te levantaste con 1.480 fichas" y vuelta al menú.

### Estados de conexión

| Estado | Qué se ve |
|---|---|
| Conectando (al tocar Mesa rápida) | Pantalla completa sobre `bg`: abanico déco animado + "Buscando mesa…". Si pasan **5 s**: "El servidor está despertando. Puede tardar hasta un minuto." + "Cancelar" |
| Reconectando (se cortó la señal) | Banda superior `surfaceRaised` "Reconectando…" con indicador; la mesa queda visible pero atenuada y la barra de acción bloqueada. Al volver, la banda desaparece y la vista se sincroniza (`table:sync`) |
| No se pudo conectar (> 90 s o sin red) | Hoja inferior: "No pudimos conectar con la mesa. Revisa tu conexión." + "Reintentar" + "Volver al menú" |
| Mesa cerrada (`table:closed`, p. ej. reinicio del servidor) | Diálogo: "La mesa se cerró. Tus fichas volvieron a tu saldo." + "Volver al menú" / "Buscar otra mesa" |
| Sesión reemplazada (`session:replaced`) | Diálogo: "Abriste la mesa en otro dispositivo." + "Volver al menú" |
| Error de acción (`NOT_YOUR_TURN`, `STALE_SEQ`, …) | Toast breve y la vista se resincroniza; nunca se muestra el código |

## 2. Contrato de diseño — Menú principal

**Disposición elegida: dos tarjetas grandes**, una por modo. Es la pantalla de inicio de la app (reemplaza al inicio actual del roguelike).

| Zona | Contenido |
|---|---|
| Barra superior | Saldo de fichas "🪙 10.000" (`money`; ícono de ficha propio, no emoji, en la implementación) · engranaje (deshabilitado hasta la 4c) |
| Título | "NAIPES" (`display`, `primary`) — nombre de trabajo |
| Tarjeta **Roguelike** | "Un jugador · sin conexión". Con run guardada: etiqueta "Run en curso · Nivel N", botón principal **Continuar run**, secundario **Nueva run**. Sin run: solo **Nueva run** (principal). Enlace pequeño "Jugar con semilla" |
| Tarjeta **Mesa** | "Hold'em en vivo · fichas virtuales", botón principal **Mesa rápida**. Sin red: botón deshabilitado + "Sin conexión" (`muted`). Primera vez: "Te damos 10.000 fichas al entrar" |

- El saldo se lee del servidor (`/v1/me`) al abrir el menú y al volver de una mesa; mientras carga, "🪙 —". Sin red, se muestra el último conocido en `muted`.
- Las dos tarjetas usan `surface` con el marco de doble filete déco de la Fase 2; el botón principal de cada una es `primary`.

## 3. Tokens

No hay tokens nuevos de color ni de tipografía: se reutilizan los de `tokens.ts`. Se agregan solo estos, en la implementación:

```ts
table: {
  felt: colors.surface,            // paño del óvalo
  feltEdge: 'rgba(201,163,90,0.4)',// filete del óvalo (primary al 40 %)
  seatEmpty: colors.border,
  timer: colors.chips,             // anillo del turno
  timerLow: colors.mult,           // últimos 5 s
  winner: colors.money,
},
sizes: {
  seatAvatar: 44,
  heroCard: { w: 64, h: 90 },
  boardCard: { w: 44, h: 62 },
  actionButtonMinHeight: 48,
},
motion: {
  dealStaggerMs: 60,
  dealMs: 220,
  flipMs: 260,
  chipsToPotMs: 300,
  potToWinnerMs: 450,
  timerLowAtMs: 5000,
  waitingHintAfterMs: 5000,
}
```

## 4. Animaciones, háptica y sonido

Todas sobre `transform`/`opacity` con Reanimated, 60 fps en gama media. Con "reducir movimiento" del sistema: fundidos de 150 ms en lugar de desplazamientos y volteos.

| Momento | Animación | Háptica | Sonido |
|---|---|---|---|
| Reparto | cartas salen del centro hacia cada asiento, escalonadas `dealStaggerMs` | — | reparto |
| Flop / turn / river | cada carta nueva se voltea (`flipMs`) | — | volteo |
| Apuesta / pago | fichas del asiento al frente; al cerrar la calle se juntan al bote (`chipsToPotMs`) | ligera al confirmar tu acción | fichas |
| Pasar | — | ligera | toc |
| Tu turno | el anillo empieza a vaciarse; la barra se ilumina | ligera | "tu turno" |
| Últimos 5 s | anillo `timerLow` + latido | — | — |
| All-in tuyo | fichas con un rebote extra | media | fichas fuerte |
| Ganas | fichas del bote a tu asiento (`potToWinnerMs`) + contador del stack | éxito | ganar |

Sonidos originales CC0 sintetizados como los del roguelike (`apps/mobile/scripts/generate-sfx.mjs`), respetando el silencio del sistema.

## 5. Accesibilidad

- Áreas táctiles ≥ 48 dp; botones de acción con texto, nunca solo ícono.
- Lector de pantalla: cada asiento es un solo elemento con su estado completo; las cartas se anuncian con nombre ("Reina de corazones"); el bote y los botones anuncian el monto ("Pagar 40 fichas").
- El palo nunca depende solo del color (siempre el símbolo SVG `SuitIcon`); contraste AA sobre `bg` y `surface`.
- Respeta el tamaño de texto del sistema hasta 1.3×; a más, los apodos se recortan y el stack se mantiene visible.
- El temporizador también se anuncia ("Te quedan 5 segundos") una vez, no en cada segundo.

## 6. Copy (es-419)

Todo en `apps/mobile/src/i18n`. Verbos de póker: **Retirarse, Pasar, Pagar, Apostar, Subir, Todo**. Textos fijos de este documento: "Buscando mesa…", "El servidor está despertando. Puede tardar hasta un minuto.", "Reconectando…", "No pudimos conectar con la mesa. Revisa tu conexión.", "La mesa se cerró. Tus fichas volvieron a tu saldo.", "Abriste la mesa en otro dispositivo.", "Si sales ahora, te retiras de esta mano. ¿Salir?", "Te levantaste con {n} fichas", "Esperando a {nombre}…", "Toca de nuevo para ir con todo", "Te damos 10.000 fichas al entrar", "Sin conexión". Números con separador de miles "." (es-419).

## 7. Hand-off

- **4a (mesa conectada):** implementa la sección 1 completa (incluidos estados de conexión y la sección 4), contra el servidor de Render, con el engine solo para tipos/vistas (la UI no calcula reglas).
- **4c (menú y cuenta):** implementa la sección 2, más el perfil (apodo, saldo, recarga diaria) y borrar cuenta, que se diseñan al empezar la 4c.
- Fuera de alcance: chat, elegir asiento, mesas privadas, avatares (placeholder con inicial), historial de manos, pre-acciones ("pasar/retirarse automáticamente").
