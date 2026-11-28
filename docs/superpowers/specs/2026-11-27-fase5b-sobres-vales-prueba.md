# Fase 5b — Prueba manual en el Galaxy A56 (sobres y vales)

Fecha: 2026-11-27 · Rama: `feat/phase-5b-packs-vouchers` (apilada sobre `feat/phase-5a-consumables`) · Diseño: [fase5b-sobres-vales-diseno.md](../../design/fase5b-sobres-vales-diseno.md) (aprobado por el controlador por delegación; **pendiente de tu revisión**).

Lo automático ya está verificado (lint, typecheck y tests del motor y de la app). Esto es lo que solo se ve en el teléfono. Las medidas del diseño son estimaciones: confírmalas aquí.

## Antes de empezar
- `pnpm dev:mobile` y abre en Expo Go (cable USB: ver CLAUDE.md). Una run nueva; para llegar rápido a la tienda gana la primera ciega (semilla `E2E-9` si quieres repetir).
- Las runs guardadas con la versión anterior se descartan: sale el aviso de siempre y se empieza de nuevo.

## Tienda
1. [ ] La tienda muestra, en este orden: comodines, consumibles, **Renovar** con el rótulo "Solo cambia comodines y consumibles", **Sobres · se abren al comprarlos** (2 filas) y **Vale · mejora permanente** (1 fila). Ningún texto se corta a 360 px.
2. [ ] Con el texto del sistema al 130 %: las filas de sobre y vale crecen en alto, el botón de precio mantiene su ancho y nada se corta.
3. [ ] El vale se alcanza con 3 desplazamientos o menos; "Siguiente ciega" y el dinero siguen fijos.
4. [ ] Sin dinero suficiente: la fila dice "Te faltan $n" y el botón no compra. Con comodines 5/5 o consumibles 2/2, el sobre del tipo correspondiente dice "Sin espacio…" y no compra (el sobre de cartas siempre se puede comprar).
5. [ ] Renovar cambia los comodines y los consumibles, pero **no** los sobres ni el vale (ni su estado de comprado).

## Sobres
6. [ ] Comprar un sobre lo abre al instante: la hoja muestra "Elige 1", el nombre del sobre y 3 opciones. No hay botón de cerrar.
7. [ ] Tocar el fondo, el botón Atrás de Android y el gesto de TalkBack **no** cierran la hoja.
8. [ ] Elegir una opción la aplica y cierra la hoja; el aviso de la tienda dice qué entró. Comodín → riel; consumible → bandeja; carta → "Ver mazo · 53".
9. [ ] Sobre de cartas: cada opción se ve como una carta con su marca de mejora ("Ref", "Car"…) y el texto "Las cartas que elijas se añaden a tu mazo."
10. [ ] "Saltar sobre" sin haber elegido pide un segundo toque ("Confirmar: saltar sin elegir"); un tercer toque no hace falta. El sobre queda cerrado y no entra nada.
11. [ ] Con 5/5 comodines no se puede comprar el sobre de comodines; para ver el error dentro de la hoja hay que tener un sobre de varias elecciones (aún no existe en el contenido): se cubre con tests.
12. [ ] **Cerrar la app con un sobre abierto** y volver a abrirla: la hoja sigue abierta con las mismas opciones.

## Vales
13. [ ] Comprar el vale: la fila queda "Comprado", aparece el aviso "Vale comprado: …" y bajo "Tus vales · 1" una píldora con el efecto corto.
14. [ ] **+1 mano / +1 descarte:** cuenta desde la **siguiente** ciega (la barra de la ciega muestra 5 manos / 4 descartes). Espacios (+1 comodín / +1 consumible): se nota al instante (hay un espacio vacío más). Renovar −$1: el botón de Renovar baja $1 al momento. Interés: con $25+ al ganar una ciega se paga $5 en vez de $4.
15. [ ] Un vale comprado no vuelve a aparecer en las tiendas siguientes; con los 6 comprados no hay sección de vale.

## Accesibilidad
16. [ ] TalkBack: cada fila lee nombre, descripción y estado; el botón dice "Comprar … por $n"; cada opción del sobre lee nombre y descripción y "Toca para elegir". Los títulos de sección son encabezados.
17. [ ] "Reducir movimiento" activado: la hoja entra con un fundido corto (sin deslizar).

## Maestro
18. [ ] `maestro test apps/mobile/.maestro/` (flujo `roguelike-first-blind`, semilla `E2E-9`): sigue comprando el comodín `minimalist` con `buy-0` (la posición 0 no cambió).

## Si algo se siente mal
- Los vales cuestan 6–10 y el simulador compra ~5 por run: si en la práctica son muy fuertes o muy caros, es costo/efecto en `content.ts` (los ajusta la 5f).
- Si 7 ofertas se sienten muchas, la opción del diseño es usar también la fila compacta para comodines y consumibles (ahorra ~240 px).
