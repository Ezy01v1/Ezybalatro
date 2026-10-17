# Fase 3d — Despliegue del servidor en Render (diseño)

Fecha: 2026-10-16 · Estado: aprobado en conversación, pendiente de revisión escrita

## Objetivo

Poner el servidor (`apps/server`) en una URL pública gratuita para que el usuario y algunos testers jueguen el Modo Mesa desde cualquier red.

**Criterio de éxito:** desde una red distinta a la de la PC (p. ej. internet compartido desde el teléfono), `pnpm play -- --guest --url https://<servicio>.onrender.com` se conecta, juega contra bots y las fichas se conservan al salir. Un push a `main` con una mesa abierta deja terminar la mano en curso antes de cerrar.

## Restricciones y supuestos

- Presupuesto: **$0**. Solo plan gratuito.
- Se acepta que el servicio **se duerma** tras 15 min sin tráfico y tarde ~1 min en despertar (la primera conexión lo despierta). Al dormirse no hay nadie jugando: perder las mesas en memoria no importa; las fichas están en la BD (recuperación de la 3b).
- No hace falta disponibilidad continua ni escala: una instancia (ADR 0004).
- Sin Docker (el usuario no tiene virtualización activada; además no aporta aquí).
- La prueba desde la app móvil queda para la Fase 4.

## Decisión de proveedor

**Render, plan `free`.** Alternativas descartadas: Koyeb free (0,1 vCPU, insuficiente para Nest + bots + Prisma), túnel desde la PC (solo funciona con la PC prendida, URL cambiante), Fly.io y Railway (sin plan gratis útil), Vercel/Netlify (sin WebSockets persistentes).

Datos de Render relevantes (verificados 2026-10-15/16):
- Desde 2026-02-24 los mensajes de WebSocket cuentan como actividad: con alguien jugando no se duerme.
- 750 horas/mes de instancia gratis (solo cuentan mientras está despierto); 512 MB RAM; puede reiniciar el servicio cuando quiera.
- `maxShutdownDelaySeconds`: 1–300, por defecto 30; luego SIGKILL.
- Regiones: no hay Canadá. Se usa **Ohio** (la más cercana a la BD en `ca-central-1`); si el plan gratis no la ofrece, **Virginia**. Verificar al crear el servicio.

Se documenta en el **ADR 0009** ("Render gratis mientras no haya presupuesto"), que matiza el ADR 0006 (que pedía "sin sleep"): se acepta el sueño y el cold start; **disparador para pasar al plan pago:** beta pública (o testers que se quejen del cold start).

## 1. Build y arranque (`render.yaml`)

Blueprint en la raíz del repo, con un servicio `web`:

| Campo | Valor |
|---|---|
| `runtime` | `node` (Node 24, fijado con `NODE_VERSION` = la versión de `.nvmrc`) |
| `plan` | `free` |
| `region` | `ohio` (o `virginia`, ver arriba) |
| `branch` | `main` |
| `autoDeployTrigger` | `checksPass` (solo despliega con el CI de GitHub en verde) |
| `healthCheckPath` | `/health` |
| `maxShutdownDelaySeconds` | `90` |
| `buildCommand` | `corepack enable && pnpm install --frozen-lockfile && pnpm build && pnpm db:migrate:deploy` |
| `startCommand` | `node apps/server/dist/src/main.js` |

- Las migraciones van al final del build porque el `preDeployCommand` de Render es solo para planes pagos. Si una migración falla, el build falla y sigue corriendo la versión anterior.
- Variables de entorno:
  - En el yaml: `NODE_ENV=production`, `SUPABASE_URL=https://kptoaakzlikfcxerckxe.supabase.co`, `LOG_LEVEL=info`, `DEV_IDENTITY=false`, `NODE_VERSION`.
  - Secretas, con `sync: false` (Render las pide al crear el Blueprint; el usuario las pega en el panel; nunca en el repo): `DATABASE_URL` (transaction pooler 6543), `DIRECT_URL` (session pooler 5432), `SUPABASE_SECRET_KEY`.
  - `PORT` la asigna Render. `CORS_ORIGINS` vacío (la app móvil no lo necesita; no hay versión web).
- Detalles a resolver en el plan: que `pnpm build` (que corre `prisma generate`) funcione con las dependencias de desarrollo instaladas en Render (con `NODE_ENV=production`, pnpm omite `devDependencies` salvo `--prod=false`), y que `corepack` respete el `packageManager` del `package.json`.

## 2. Drenado al apagar

Hoy, al recibir `SIGTERM`, `TableDirector.shutdown()` deja de repartir (`stopDealing`) y **cierra cada mesa en el acto** (`close('shutdown')`): la mano en curso se anula (`voided`) y cada jugador cobra el stack previo a esa mano. Se cambia a drenado, como pide el ADR 0004:

1. Al empezar el apagado: no se aceptan asientos nuevos (ya existe: `shuttingDown`) y ninguna mesa reparte una mano nueva (`stopDealing`, ya existe).
2. Se espera a que **cada mesa termine su mano en curso** (se liquide y se guarde), con un **tope global de 60 s** (configurable: `SHUTDOWN_DRAIN_MS`, por defecto 60000; en tests, con el scheduler falso).
3. Al terminar todas, o al vencer el tope, se cierra cada mesa como hoy (`close('shutdown')`: cash-out al wallet y `table:closed { reason: 'shutdown' }`). Una mano que siga abierta al vencer el tope se anula como ahora.
4. `maxShutdownDelaySeconds: 90` en Render deja margen sobre los 60 s del drenado más el cierre de conexiones y de la BD.

Durante el drenado los turnos y sus timeouts siguen corriendo con normalidad (20 s por turno), así que una mano casi siempre termina dentro del tope. Los clientes conectados no reciben ningún mensaje nuevo hasta el `table:closed`; el aviso explícito de "el servidor se va a reiniciar" queda fuera de alcance (se puede agregar en la Fase 4 si la UI lo necesita).

El orden de cierre de Nest no cambia: `TablesModule.beforeApplicationShutdown` (drenado + cierre de mesas + cierre de conexiones) y luego la BD en `onApplicationShutdown`.

## 2b. Deploys sin corte: dos instancias a la vez (agregado 2026-10-16)

Render arranca la instancia nueva, espera a que esté sana, y **60 s después** manda `SIGTERM` a la vieja (no se puede desactivar en free). La recuperación de la 3b suponía que el proceso anterior ya murió y devolvía **todos** los asientos de la BD: con la vieja drenando, le quitaba los asientos y el drenado no servía. Aprobado por el usuario (opción A):

- **Candado de instancia:** cada proceso, al arrancar, intenta tomar un advisory lock de sesión de Postgres (`pg_try_advisory_lock`, clave fija) en una conexión dedicada por `DIRECT_URL` (session pooler; el transaction pooler no conserva locks de sesión). Sin `DIRECT_URL` (desarrollo, tests) usa `DATABASE_URL`. En producción `DIRECT_URL` pasa a ser obligatoria.
- **El arranque no espera el candado:** la app arranca y atiende enseguida (si esperara, Render nunca daría por sana la nueva y nunca apagaría la vieja). La recuperación corre en segundo plano: reintenta el candado cada 2 s y, al tenerlo, recupera.
- **La recuperación excluye las mesas vivas de este proceso:** solo devuelve asientos (y solo cierra mesas) cuyo `table_id` no esté en el director. Así no toca las mesas que la instancia nueva abrió mientras esperaba.
- El candado se suelta al apagar (después de cerrar las mesas) o solo, si el proceso muere (Postgres cierra la sesión).
- Si la conexión del candado se cae, se registra un `error` y se reintenta tomarlo; mientras tanto no se recupera nada (nunca se recupera sin candado).

## 3. Seguridad, CI y documentación

- Con `NODE_ENV=production` el server ya exige `DATABASE_URL` y `SUPABASE_SECRET_KEY` y prohíbe `DEV_IDENTITY=true`. Swagger (`/docs`) queda público: no expone secretos.
- `autoDeployTrigger: checksPass`: un push a `main` con CI rojo no se despliega.
- ADR 0009 nuevo; `CLAUDE.md` actualizado (comandos de deploy, URL del servicio, estado de la 3d); `docs/protocol.md` si cambia algo visible para el cliente (no se espera).

## 4. Pruebas

Automáticas (Jest, con el scheduler falso que ya existe):
- Apagado con una mano en curso: la mano termina, se liquida y se guarda **antes** del cierre; el cash-out paga el stack posterior a la mano.
- Apagado con una mano que no termina antes del tope: al vencer, la mano se anula y el cash-out paga el stack previo (comportamiento actual).
- Durante el drenado no empieza ninguna mano nueva y `quickSeat` responde `TABLE_CLOSED`.
- Apagado sin manos en curso: cierra de inmediato (no espera el tope).

Manual (usuario, tras el primer deploy):
1. `https://<servicio>.onrender.com/health` responde 200.
2. `pnpm play -- --guest --url https://<servicio>.onrender.com` desde otra red: se sienta, juega contra bots, `leave`, fichas conservadas.
3. Push a `main` con la mesa abierta: la mano en curso termina y llega `table:closed { reason: 'shutdown' }`.
4. Más de 15 min sin uso y volver a entrar: despierta en ~1 min.

## Pasos que hace el usuario (no Claude)

- Crear la cuenta de Render (gratis; puede entrar con GitHub) y conectar el repo `Ezy01v1/Ezybalatro` con el Blueprint.
- Pegar en el panel de Render `DATABASE_URL`, `DIRECT_URL` y `SUPABASE_SECRET_KEY` (idealmente ya rotadas, ver la 3c).
- Merge a `main` y push.

## Fuera de alcance

- Plan pago, dominio propio, monitoreo externo o "pings" para que no se duerma.
- Modo Mesa en la app móvil y su pantalla de "Conectando…" (Fase 4).
- Aviso previo al cliente antes de un reinicio.
