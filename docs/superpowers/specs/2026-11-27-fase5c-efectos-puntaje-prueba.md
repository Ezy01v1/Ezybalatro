# Fase 5c — Prueba manual en el Galaxy A56 (efectos de puntaje y ediciones)

Fecha: 2026-11-27 · Rama: `feat/phase-5b-packs-vouchers` (la 5c va encima de la 5b, sin rama propia) · Diseño: [fase5c-efectos-puntaje-design.md](2026-11-27-fase5c-efectos-puntaje-design.md) · ADR: [0010](../../decisions/0010-puntaje-repeticiones-azar-ediciones.md)

Lo automático ya está verificado (lint, typecheck, tests del motor y de la app, propiedades de determinismo). Esto es lo que solo se ve en el teléfono. La presentación de las ediciones (rótulo de texto + borde de color) la decidió Claude por delegación: **pendiente de tu revisión**.

## Antes de empezar
- `pnpm dev:mobile` y abre en Expo Go (cable USB: ver CLAUDE.md). Una run nueva: las guardadas con la versión 3 se descartan con el aviso de siempre.
- Para ver ediciones rápido, abre tiendas (gana la primera ciega con la semilla `E2E-9`) y renueva varias veces: cada oferta de comodín trae edición 1 de cada 8.

## Ediciones
1. [ ] Una oferta de comodín con edición muestra una línea «Edición <nombre>: <efecto>» y su precio incluye el sobreprecio ($2–$4 más). Ningún texto se corta a 360 px ni con el texto del sistema al 130 %.
2. [ ] Al comprarla, el comodín aparece en el riel con un rótulo corto (Lám., Aura, Irid., Ampl.) arriba a la izquierda y el borde de su color. El rótulo se lee aunque no distingas colores.
3. [ ] Tocar el comodín abre el detalle con la línea de edición. «Vender» muestra el valor con el sobreprecio (la mitad del total, redondeada hacia abajo).
4. [ ] **Amplio:** con 5/5 comodines y uno de ellos Amplio, aparece un sexto espacio vacío en el riel y se puede comprar un sexto comodín. Vender el Amplio con 6/6 deja 5/5 sin errores.
5. [ ] Lámina, Aura e Iridiscente: al puntuar, el comodín «salta» una segunda vez al final con la edición (+50 fichas, +10 mult, ×1,5) y el marcador lo refleja.
6. [ ] Los comodines que salen de un sobre no traen edición.

## Repeticiones
7. [ ] Con «Eco de la Corte» (o «Eco del Corazón», «Primer Bis», «Último Bis») en el riel, jugar una mano con las cartas afectadas: cada carta repetida puntúa dos veces y el segundo paso lleva «↻» delante («↻ +10»).
8. [ ] Con varias repeticiones (por ejemplo dos ecos y una mejora), el conteo de puntaje no pasa de ~2,5 s y sigue siendo legible; la carta no se repite más de 3 veces.
9. [ ] Una carta con mejora (Cargada, Reforzada) repetida repite también su mejora y los comodines de carta (p. ej. «Corazón Terco»).

## Suerte
10. [ ] «Chispa», «Dado Cargado», «Moneda de la Suerte» y la mejora «Moneda» (sale en un sobre de cartas): al acertar la tirada se ve el paso (+3 mult, ×2, +$4, +20 mult); al fallar, nada. Repetir la misma run con la misma semilla y las mismas jugadas da lo mismo.
11. [ ] Cerrar la app a mitad de una ciega y volver a abrirla: la run sigue y las tiradas siguientes continúan igual (el estado de la suerte se guarda).

## Accesibilidad
12. [ ] TalkBack en el riel lee «<nombre>: <efecto>. edición <nombre>». El rótulo de edición no se lee por separado.
13. [ ] Con «Reducir movimiento» el conteo no depende de animaciones largas.

## Maestro
14. [ ] `maestro test apps/mobile/.maestro/` (flujo `roguelike-first-blind`, semilla `E2E-9`): compra `buy-0` (ahora el comodín «Último Bis», $6) y muestra `joker-j1`. Requiere Java 17+ en el equipo.

## Si algo se siente mal
- Las ediciones te parecen demasiado raras o frecuentes: `editionOneIn` en la config (8 = 1 de cada 8 ofertas).
- El simulador da ~7 % de victorias con el bot de siempre; los números finos (costos, bonos, probabilidades de suerte) se ajustan en la 5f.
