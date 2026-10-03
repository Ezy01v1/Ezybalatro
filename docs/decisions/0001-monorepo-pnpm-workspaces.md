# 0001. Monorepo con pnpm workspaces (sin Turborepo en MVP)
Estado: Aceptado
Fecha: 2026-10-03

## Contexto
Hay cuatro piezas que comparten tipos y reglas: `apps/mobile` (Expo), `apps/server` (NestJS), `packages/engine` (reglas puras) y `packages/shared` (schemas Zod). El engine tiene que ser el mismo código en el cliente (roguelike offline) y en el servidor (mesa). El equipo es de 1 persona.

Verificado en la documentación de Expo (docs.expo.dev/guides/monorepos, consultada el 2026-10-03):
- Desde SDK 52, `expo/metro-config` detecta el monorepo y configura Metro por su cuenta (`watchFolders`, `nodeModulesPaths`). No hay que tocar `metro.config.js`.
- Desde SDK 54, Expo soporta instalaciones aisladas (el default de pnpm). Si alguna librería nativa falla, la salida documentada es `nodeLinker: hoisted` en `pnpm-workspace.yaml`.
- No se soportan versiones duplicadas de `react-native` ni de `react` en una misma app. Los módulos nativos nunca deben duplicarse. `experiments.autolinkingModuleResolution` (SDK 54+) alinea Metro con el autolinking.

SDK elegido: **Expo SDK 57** (`expo@57.0.26`, dist-tag `latest` en npm al 2026-10-03). Las versiones exactas de React y React Native serán las que fije `create-expo-app` / `expo install` para ese SDK.

## Opciones consideradas
1. **pnpm workspaces**. Pros: instalación rápida; `workspace:*` impide resolver un paquete homónimo de npm; es estricto con las dependencias no declaradas. Contra: el modo aislado todavía rompe algunas librerías de RN.
2. **npm workspaces**. Pros: no hay que instalar nada extra y hace hoisting por defecto (menos sorpresas en RN). Contras: es más lento y deja usar dependencias no declaradas.
3. **Yarn Berry / Bun**. Sin ventaja concreta para este proyecto.
4. **Agregar Turborepo/Nx**. Dan cache de tareas, pero con 4 paquetes chicos no compensan la configuración extra.

## Decisión
pnpm workspaces, con la versión fijada en `packageManager` (`package.json` raíz) vía Corepack. Arrancamos con el modo aislado por defecto. Si una librería nativa falla, pasamos a `nodeLinker: hoisted` y lo anotamos aquí. Los scripts de la raíz usan `pnpm -r` / `pnpm --filter`. Sin Turborepo.

`engine` y `shared` se consumen desde mobile como TypeScript fuente (Metro transpila). Se compilan con `tsc` a `dist/` para el servidor.

**Implementado (Fase 0):** `exports` condicionales en cada paquete: `react-native` → `src/index.ts` (Metro), `types` → `dist/index.d.ts`, `default` → `dist/index.js` (CommonJS). Los scripts raíz `typecheck`, `test`, `build` y `dev:server` corren `build:packages` primero. pnpm 10.34.6 (instalado con `npm i -g`, porque Corepack no tenía permisos sobre `C:\Program Files\nodejs`). Modo aislado funcionando con SDK 57: `expo-doctor` pasa 21/21 y `expo export` compila.

## Consecuencias
- Un solo `pnpm install` y un solo lockfile. CI simple.
- Hay que vigilar duplicados de `react` / `react-native` (`pnpm why react-native`).
- pnpm no está instalado en esta máquina: hay que habilitarlo con `corepack enable`.

## Disparador para revisar
- El CI tarda más de 10 min por tareas repetidas → agregar Turborepo.
- Más de 2 librerías nativas incompatibles con el modo aislado → `nodeLinker: hoisted` permanente o cambio a npm.
