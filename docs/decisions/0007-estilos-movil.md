# 0007. Estilos en móvil: StyleSheet + tokens tipados (sin NativeWind en el MVP)
Estado: Aceptado
Fecha: 2026-10-03

## Contexto
Hay dos tipos de pantalla: la mesa de juego (cartas con Reanimated, posiciones calculadas, estilos animados) y la UI de app (menús, tienda, lobby). Tema oscuro fijo. Expo SDK 57 con Reanimated 4.

En npm al 2026-10-03: `nativewind@4.2.7` (latest) y `react-native-reanimated@4.7.1`. **Verificar** que NativeWind 4.x declare compatibilidad con Reanimated 4 y con SDK 57. NativeWind v4 se apoya en Reanimated para animar y en Tailwind v3.

## Opciones consideradas
1. **NativeWind**. Pro: maquetar menús con sintaxis Tailwind es rápido. Contras: una capa de transformación extra, historial de roturas al subir de SDK y poco valor en la mesa, donde los estilos son dinámicos y animados.
2. **StyleSheet + tokens tipados** (`theme/tokens.ts`). Pros: cero dependencias, sin riesgo al actualizar el SDK, se combina de forma natural con los estilos animados. Contra: más verboso en los menús.
3. **Tamagui / Unistyles / Restyle**. Más potencia, pero otra dependencia con su propio ciclo de versiones.

## Decisión
StyleSheet + tokens tipados en `apps/mobile/src/theme/`. El agente `disenador-ui-ux` define los tokens en la Fase 2. Habrá primitivas mínimas propias (`Text`, `Button`, `Screen`) que solo aceptan tokens.

## Consecuencias
- Los upgrades de SDK no tienen una capa de estilos que pueda romperse.
- Más código en las pantallas de menú. Aceptable: son pocas.

## Disparador para revisar
- Más de ~15 pantallas de UI de app, con la maquetación como cuello de botella → evaluar NativeWind o Unistyles, verificando la compatibilidad en ese momento.
