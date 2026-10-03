# 0002. Plataforma móvil: Expo + React Native
Estado: Aceptado
Fecha: 2026-10-03

## Contexto
Juego de cartas vertical, para usar con una mano. El objetivo principal es Android de gama media con datos móviles; iOS también. El roguelike funciona 100% offline. Las animaciones de cartas (repartir, seleccionar, puntuar, activar comodín) deben ir a 60 fps. Fuera de la mesa, la UI (menús, lobby, tienda) es de app clásica. El dev domina React/TypeScript.

## Opciones consideradas
| Criterio | Expo + React Native (+ Reanimated/Skia) | Capacitor + motor web 2D (PixiJS / Phaser) |
|---|---|---|
| Fluidez de las cartas | Reanimated corre en el hilo de UI: transform/opacity a 60 fps en gama media si no hay re-render por frame. | WebGL dentro de un WebView: muy bueno en gama media-alta; en gama media depende del WebView del sistema. |
| Efectos (brillo, partículas, shaders) | Posibles con Skia, pero con más trabajo y menos ejemplos. | Su punto fuerte: filtros, partículas y tweens listos. |
| UI de app y accesibilidad | Componentes nativos, accesibilidad del SO, safe areas, botón atrás. | HTML/CSS o canvas; la accesibilidad dentro del canvas es pobre. |
| Tamaño | Moderado (medir en el primer build de EAS). | Moderado (WebView del sistema + JS del motor). |
| Offline | Nativo (expo-sqlite, assets empaquetados). | Igual de bien. |
| Publicación y OTA | EAS Build/Submit/Update con `runtimeVersion`. | Android Studio/Xcode; OTA con servicios de terceros (verificar estado). |

## Decisión
Expo SDK 57 + React Native con expo-router. Reanimated + Gesture Handler para las cartas; Skia solo para efectos puntuales.

**Qué sacrificamos:** el "juice" visual barato de un motor 2D. Partículas, shaders y tweens encadenados cuestan más horas en Skia/Reanimated. Tampoco tendremos una versión web gratis. Lo aceptamos porque casi toda la app es UI de aplicación (menús, tienda, lobby, botones de apuesta), donde RN es mejor, y porque el estado del juego sale de un reducer puro que no depende del renderer.

## Consecuencias
- Zustand envuelve el reducer del engine; la UI solo despacha acciones y renderiza.
- Expo Go alcanza para empezar (Reanimated, Skia, SQLite y haptics vienen incluidos; verificar para SDK 57). MMKV u otros módulos nativos de terceros obligan a usar un development build, por eso se prefiere expo-sqlite para guardar la run.
- Perfilar en un Android de gama media real desde la Fase 2.

## Disparador para revisar
- En un Android de gama media real, la puntuación con 5 cartas + 5 comodines animando cae por debajo de ~50 fps después de optimizar → probar a renderizar la mesa del roguelike con un canvas de Skia completo (sigue siendo RN) antes de considerar otra plataforma.
