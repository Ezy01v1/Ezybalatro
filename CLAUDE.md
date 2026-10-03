# Naipes (nombre de trabajo — cámbialo cuando tengas el definitivo)

Contexto del proyecto para Claude Code y los agentes de `.claude/agents/`. Lo que dice este archivo manda sobre los defaults de los agentes. Si una sección dice "decidir en Fase 0", el ADR correspondiente la reemplaza cuando exista.

## Qué es

- App móvil (iOS + Android) de cartas con dos modos en la misma app:
  1. **Modo Roguelike** (un jugador, funciona offline): runs de póker donde juegas manos de 1 a 5 cartas para alcanzar un puntaje objetivo, con comodines que modifican la puntuación, tienda entre rondas y dificultad creciente. Inspirado en la mecánica de Balatro, con nombre, arte, textos, sonidos y set de comodines 100% originales.
  2. **Modo Mesa** (multijugador en tiempo real): Texas Hold'em No-Limit, 2 a 6 jugadores por mesa, con fichas virtuales sin valor monetario. Bots para llenar mesas y para desarrollar sin depender de otras personas.
- **Usuarios:** jugadores casuales de Latinoamérica (español primero) que juegan sesiones cortas en el teléfono, con una mano, a veces con datos móviles.
- **Flujo más frecuente:** abrir la app → continuar la run del roguelike, o "mesa rápida" para sentarse en una mesa con lugar.
- **Flujos raros pero de alto riesgo:** desconexión a mitad de mano con fichas en el bote; reparto con varios all-in (botes laterales); movimientos de fichas entre wallet y mesa; reinicio del servidor a mitad de mano.
- **Fuera de alcance (MVP):** dinero real, premios, compra de fichas, transferencia de fichas entre jugadores, torneos, chat libre, variantes distintas a Hold'em, versión web o escritorio.

## Stack y versiones

- Monorepo con workspaces (pnpm por defecto — decidir en Fase 0, ADR 0001):

```
apps/
  mobile/    Expo (React Native) + TypeScript strict + expo-router
  server/    NestJS + gateway Socket.IO + REST/OpenAPI
packages/
  engine/    reglas puras en TypeScript: cartas, RNG, evaluador de manos,
             máquina de estados de Hold'em, scoring del roguelike.
             SIN React, Nest, red, reloj ni Math.random.
  shared/    schemas Zod y tipos de mensajes cliente↔servidor y DTOs
docs/
  decisions/ ADRs
  protocol.md
```

- **Runtime:** Node.js LTS (fijado en `.nvmrc`) · TypeScript strict en todo el repo.
- **Móvil:** Expo + expo-router · animaciones con react-native-reanimated + react-native-gesture-handler · efectos visuales opcionales con @shopify/react-native-skia · expo-haptics · audio con la librería de audio vigente de Expo · tokens en expo-secure-store · guardado local de la run con expo-sqlite (o MMKV si se usa development build) · estilos de la UI (menús, lobby) con NativeWind o StyleSheet + tokens — decidir en Fase 0 verificando compatibilidad con el SDK de Expo.
- **Estado en el cliente:** Zustand para el estado del juego (envuelve al reducer del engine; la UI nunca calcula reglas) · TanStack Query para datos REST del servidor · socket.io-client para el Modo Mesa.
- **Backend:** NestJS · Socket.IO (`@nestjs/websockets`) · API REST + OpenAPI (Swagger).
- **Base de datos:** PostgreSQL en Supabase o Neon — decidir en Fase 0 (ADR 0005) · conexión pooled para la app, directa para migraciones.
- **ORM / migraciones:** Prisma o Drizzle — decidir en Fase 0.
- **Auth:** cuenta de invitado al primer arranque + vincular Google/Apple/email sin perder progreso — proveedor según ADR 0005.
- **Jobs/colas:** ninguno en MVP (pg-boss si aparece la necesidad).
- **Redis:** ninguno en MVP. Una sola instancia del servidor con el estado de mesas en memoria (ver ADR 0004 y su disparador para escalar).
- **Hosting del servidor:** proceso persistente (WebSockets), NO serverless — decidir en Fase 0 (ADR 0006).
- **Tests:** Vitest + fast-check en `packages/engine` · runner por defecto de Nest en `apps/server` · jest-expo + React Native Testing Library en `apps/mobile` · Maestro para e2e móvil.
- **Builds y publicación:** EAS Build / EAS Submit / EAS Update.
- **Repo:** https://github.com/Ezy01v1/Ezybalatro.git · rama principal `main`.

## Comandos

Todos se corren desde la raíz. Requisitos: Node 24 (`.nvmrc`) y pnpm 10 (`packageManager` en `package.json`; si Corepack no tiene permisos, `npm i -g pnpm@10`).

- Instalar: `pnpm install`
- Dev móvil: `pnpm dev:mobile` (Expo; escanea el QR desde Expo Go). Por Wi‑Fi el Firewall de Windows bloquea el puerto 8081; lo que funciona es el cable USB: `adb reverse tcp:8081 tcp:8081` y luego `adb shell am start -a android.intent.action.VIEW -d exp://127.0.0.1:8081 host.exp.exponent` (adb en `%LOCALAPPDATA%\Android\Sdk\platform-tools`). Dispositivo de prueba: Samsung Galaxy A56.
- Dev servidor: `pnpm dev:server` (copia `apps/server/.env.example` a `apps/server/.env`)
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck` (compila antes `packages/*`)
- Tests: `pnpm test` (todo) · `pnpm test:engine` (cobertura: `pnpm --filter @naipes/engine test:coverage`) · `pnpm test:server` (unit + e2e) · `pnpm test:mobile` · e2e móvil con Maestro: pendiente
- Build: `pnpm build` (packages + server) · bundle móvil: `pnpm export:mobile`
- Compilar solo los paquetes compartidos: `pnpm build:packages`
- Migraciones (crear / aplicar): pendiente, Fase 3 (Prisma, ADR 0005)
- Seed: pendiente, Fase 3
- Simulación de balance del roguelike: pendiente, Fase 1/2

Notas del esqueleto:
- `packages/engine` y `packages/shared` compilan a CommonJS en `dist/`. Metro (mobile) los consume desde `src/` por la condición `react-native` de `exports`; server y typecheck usan `dist/`. Por eso `typecheck`, `test` y `dev:server` corren `build:packages` primero.
- Nest 12 se publica solo como ESM; el server es CommonJS y lo carga con `require(esm)` de Node 24. Jest del server corre con `--experimental-vm-modules` (igual que la plantilla oficial de Nest 12).
- En `apps/mobile`, los tests van en `src/__tests__/` (nunca en `src/app/`: expo-router trataría cualquier archivo ahí como una ruta). RNTL 14: `await render(...)`.

## Convenciones del proyecto

- Código, nombres, commits y ramas en inglés. UI en español (es-419), con los textos centralizados en un solo lugar para poder traducir después.
- Conventional Commits · ramas cortas `feat/…`, `fix/…` · PR con squash merge · CI verde obligatorio.
- Formato de error REST: `{ "error": { "code": "…", "message": "…", "requestId": "…" } }`.
- Errores del socket: `{ "type": "error", "code": "NOT_YOUR_TURN" | "INVALID_AMOUNT" | "STALE_SEQ" | …, "message": "…" }`.
- Las reglas del juego viven SOLO en `packages/engine`. Si una regla aparece en un componente, un gateway o un service, es un bug.
- Contenido del roguelike (comodines, jefes, consumibles, tabla de objetivos) definido como datos en archivos de configuración, no como `if` repartidos por el código.

## Diseño

- No hay Figma: el agente `disenador-ui-ux` (modo DISEÑAR) produce contrato de diseño y tokens antes de implementar pantallas.
- Temática visual: por definir. Se proponen 3 direcciones originales en la Fase 2. No imitar el estilo de Balatro (fondo con shader psicodélico, tipografía pixel, paleta, layout de su pantalla).
- Orientación vertical, uso con una mano, 360 px de ancho como referencia mínima.
- Densidad: compacta en la mesa de juego; equilibrada en menús.
- Tema oscuro: el juego es de fondo oscuro por diseño; no hace falta toggle de tema.
- Animaciones con propósito (repartir, seleccionar, puntuar, activar comodín), sobre transform/opacity, 60 fps en Android de gama media, respetando "reducir movimiento" del sistema.

## Dominio

### Glosario — Modo Roguelike

- **Run:** partida completa desde el nivel 1 hasta ganar o perder.
- **Nivel (ante):** 8 niveles; cada uno tiene 3 ciegas: pequeña, grande y jefe.
- **Ciega:** ronda con un puntaje objetivo. El jugador tiene N manos y M descartes para alcanzarlo.
- **Mano jugada:** 1 a 5 cartas seleccionadas. Se detecta el tipo de mano y solo las cartas que la forman "puntúan".
- **Puntaje de una mano:** Fichas × Multiplicador. Cada tipo de mano tiene fichas y multiplicador base, y nivel mejorable.
- **Comodín** (nombre final pendiente): modificador pasivo. Espacios limitados (5 por defecto). El orden de izquierda a derecha importa.
- **Consumible:** carta de un solo uso (subir de nivel un tipo de mano, modificar cartas del mazo, etc.).
- **Jefe:** ciega con una regla que estorba (p. ej. un palo no puntúa).
- **Tienda:** entre ciegas; se paga con el dinero de la run (no son las fichas del Modo Mesa).
- **Semilla:** texto que determina toda la aleatoriedad de la run.

### Glosario — Modo Mesa

- **Fichas (wallet):** saldo virtual del usuario fuera de la mesa.
- **Stack:** fichas que el jugador tiene sentado en una mesa.
- **Buy-in / cash-out:** pasar fichas de wallet a mesa y de vuelta.
- **Mano (hand):** una repartición completa con ID propio.
- **Calle:** preflop, flop, turn, river.
- **Bote principal / botes laterales:** se crean cuando hay all-in de distintos tamaños.
- **Showdown:** comparación de manos al final.
- **Sentado fuera (sitting out):** en la mesa pero sin recibir cartas.

### Entidades y estados

- Run: `in_progress → won | lost | abandoned`
- Table: `open → running → closed`
- Seat: `empty → seated → sitting_out → leaving → empty`
- Hand: `waiting → preflop → flop → turn → river → showdown → settled` (atajo: si todos menos uno se retiran, pasa directo a `settled`). Desde cualquier calle puede pasar a `voided` si el servidor se reinicia a mitad de mano (ADR 0004): la mano se anula y los stacks vuelven a los del final de la mano anterior.
- Diagramas completos de estados y ERD: `docs/domain-model.md`.

### Invariantes críticas (nunca se pueden romper)

1. **Conservación de fichas:** durante una mano, suma(stacks) + suma(botes) es constante. Al liquidar no se crean ni se pierden fichas; la ficha impar de un empate va al primer ganador a la izquierda del botón. A nivel global: suma(wallets) + suma(stacks en mesas) solo cambia por movimientos registrados en el ledger (recarga diaria, recompensas).
2. Cada carta existe una sola vez por mazo / por mano.
3. El servidor es la única autoridad del Modo Mesa. El cliente envía intenciones; el servidor valida turno, monto mínimo de subida, stack disponible y número de secuencia.
4. Las cartas privadas de un jugador nunca llegan a otro cliente antes del showdown: ni en payloads, ni en logs, ni en estado de depuración, ni en mensajes de error.
5. **Aleatoriedad:** en el Modo Mesa, barajado Fisher-Yates con CSPRNG (`crypto`) en el servidor. En el roguelike, PRNG con semilla: misma semilla + mismas acciones = mismo resultado, siempre.
6. El engine es puro y determinista: recibe el RNG y el tiempo inyectados; no lee reloj, red ni `Math.random`.
7. Movimientos de fichas wallet ↔ mesa en transacción, con asiento en `chip_ledger` y `UPDATE` condicionado. Nunca leer → calcular en JS → escribir. Saldo nunca negativo (CHECK en BD).
8. Fichas como enteros (`bigint` en BD, enteros en el engine). El puntaje del roguelike puede crecer muchísimo y usar multiplicadores decimales: se representa como `number` con notación científica en la UI; si el juego tardío lo desborda, se migra a una librería de números grandes (decisión documentada en ADR).

## Restricciones

- **Sin dinero real:** fichas virtuales gratuitas (saldo inicial + recarga diaria), sin cash-out, sin premios, sin compra de fichas en el MVP, no transferibles entre jugadores. Monetización futura, si la hay, solo con cosméticos o anuncios, y con revisión previa de políticas.
- **Tiendas:** el Modo Mesa es simulación de apuestas → clasificación por edad alta en App Store y Google Play. Verificar los requisitos vigentes de ambas tiendas antes de publicar (cambian seguido). Apple exige poder borrar la cuenta desde la app.
- **Propiedad intelectual:** no usar el nombre "Balatro" (tampoco en la ficha de la tienda), ni su arte, tipografía, música, nombres o textos de comodines. Las mecánicas generales sirven de inspiración; todo el contenido es original.
- **Dispositivos:** Android de gama media con datos móviles es el objetivo principal; también iOS. El roguelike funciona completo sin red.
- Idioma es-419 · BD en UTC (`timestamptz`) · el "día" de la recarga diaria y del desafío diario se define en UTC salvo que un ADR diga otra cosa.
- Presupuesto mensual de infraestructura: <completar> (planes gratuitos al inicio).
- **Datos personales:** mínimos (nickname, avatar de un set predefinido, proveedor de login). Sin uploads de fotos en MVP.

## Decisiones tomadas

- ADRs en `docs/decisions/` (no se contradicen sin un ADR nuevo que los reemplace). Aceptados el 2026-10-03:
  - 0001 pnpm workspaces, sin Turborepo · Expo SDK 57
  - 0002 Expo + React Native (Reanimated; Skia solo para efectos)
  - 0003 Engine puro: `Rng` inyectado, tiempo como acción, `viewFor` redacta la vista de cada asiento
  - 0004 Socket.IO autoritativo, 1 instancia, mesas en memoria, persistencia al liquidar cada mano
  - 0005 Supabase (Postgres + Auth, solo vía backend) · ORM **Prisma**
  - 0006 PaaS con proceso persistente (proveedor a elegir en Fase 3)
  - 0007 StyleSheet + tokens tipados (sin NativeWind)
  - 0008 Reglas de Hold'em: dead button completo con ciegas perdidas, reapertura acumulada de all-ins incompletos (TDA), timeout = check o fold + sitting out, muck automático de perdedores
- Decisiones rápidas sin ADR todavía:
  - Una sola app con dos modos.
  - Hold'em No-Limit, 2–6 jugadores, mesas de cash con fichas virtuales.
  - Roguelike primero (sale antes, no depende del servidor); multijugador después.

## Estado actual

- **Hecho:** Fase 0. ADRs 0001–0007 aceptados, modelo de dominio (`docs/domain-model.md`), esqueleto del monorepo (mobile con pantalla de inicio, server con `/health` + gateway `ping`, engine con `Rng`/`shuffle`, shared con schemas de error), lint/typecheck/tests desde la raíz, CI en GitHub Actions.
- **Hecho:** Fase 1 (engine), en `main`: cartas, `SeededRng` (sfc32 + cyrb128, sub-streams por propósito), evaluador Hold'em (5 de 7) y del roguelike (1–5 cartas), reducer de Hold'em NL (`holdemReducer`, `legalActions`, `viewFor`, botes laterales), scoring del roguelike con comodines como datos + hooks, y reducer de la run con log reproducible (`createRun`/`runReducer`/`replayRun`). El mazo de cada mano de Hold'em entra barajado en la acción `postBlinds` (lo baraja el server con CSPRNG).
- **Hecho:** reglas de Hold'em validadas por el usuario (ADR 0008): dead button y muck de perdedores implementados.
- **En curso:** —
- **Siguiente:** Fase 2 (roguelike jugable en el móvil).
- **Deuda técnica conocida:**
  - Roguelike: mejoras de carta existen en el pipeline pero aún no hay forma de obtenerlas; consumibles solo "subir nivel de mano".
  - Los tests e2e del server tardan ~30 s (probablemente por el cierre del socket); revisar.
  - Swagger/OpenAPI todavía no está montado (se agrega con el primer endpoint REST real).
  - Logs estructurados (pino + requestId) y `helmet` pendientes para antes de exponer el server.
  - `docs/protocol.md` se crea en la Fase 3.
