# 0009. Hosting: Render, plan gratis, mientras no haya presupuesto
Estado: Aceptado (matiza el ADR 0006)
Fecha: 2026-10-16

## Contexto
El ADR 0006 eligió un PaaS con una instancia persistente "sin sleep" y dejó el proveedor para la Fase 3. En la Fase 3d el presupuesto es $0: el servidor solo tiene que estar en una URL pública para el usuario y algunos testers, que aceptan esperar a que despierte. Las mesas viven en memoria (ADR 0004) y las fichas en Supabase (ADR 0005, proyecto en `ca-central-1`).

## Opciones consideradas (datos verificados el 2026-10-15/16)
1. **Render, plan `free`.** Deploy desde GitHub con Blueprint (`render.yaml`), HTTPS, health check. Se duerme tras 15 min sin tráfico (desde 2026-02-24 los mensajes de WebSocket cuentan como tráfico) y tarda ~1 min en despertar. 512 MB, 750 h/mes, puede reiniciar cuando quiera. Sin región en Canadá (la más cercana: Ohio). Pre-deploy solo en planes pagos. Deploys sin corte: arranca la instancia nueva y 60 s después manda `SIGTERM` a la vieja.
2. **Koyeb, instancia gratis.** Se duerme tras 1 h; solo 0,1 vCPU (poco para Nest + bots + Prisma); Washington o Frankfurt.
3. **PC del desarrollador + túnel gratuito.** Sin límites de CPU, pero solo funciona con la PC prendida y la URL cambia.
4. **Fly.io, Railway:** sin plan gratis útil. **Vercel, Netlify:** sin WebSockets persistentes.

## Decisión
**Render `free`, región `ohio`**, servicio definido en `render.yaml`: runtime Node nativo (sin Docker; versión desde `.nvmrc`), build = instalar + compilar + `prisma migrate deploy` (al no haber pre-deploy gratis, una migración fallida hace fallar el build y sigue la versión anterior), auto-deploy solo con CI verde (`autoDeployTrigger: checksPass`), health check en `/health`, `maxShutdownDelaySeconds: 90`. Secretos (`DATABASE_URL`, `DIRECT_URL`, `SUPABASE_SECRET_KEY`) solo en el panel de Render.

Para convivir con los deploys sin corte:
- **Drenado** al recibir `SIGTERM`: no se reparten manos nuevas y se espera a que terminen las actuales, hasta `SHUTDOWN_DRAIN_MS` (60 s); después se cierran las mesas y se paga a todos.
- **Candado de instancia:** advisory lock de sesión de Postgres por `DIRECT_URL` (session pooler). La recuperación de asientos al arrancar corre en segundo plano y solo después de que la instancia anterior suelta el candado; nunca toca las mesas vivas del proceso. Si la conexión del candado se cae, un latido cada 10 s reconecta y lo vuelve a tomar. La propiedad del candado es "de mejor esfuerzo": la seguridad de las fichas no depende de él, sino de que cada pago de un asiento es un borrado condicional (nunca se paga dos veces).

## Consecuencias
- Costo $0. Cold start de ~1 min cuando nadie jugó en los últimos 15 min; la app debe mostrar "Conectando…" (Fase 4).
- Al dormirse o reiniciarse se pierden las mesas en memoria; las fichas vuelven al wallet (drenado o recuperación).
- Latencia extra Ohio ↔ `ca-central-1` (~15–25 ms) por consulta a la BD.
- `DIRECT_URL` pasa a ser obligatoria en producción.
- Un servidor de desarrollo local apuntando a la misma base de Supabase compite por el candado: no recupera nada mientras producción esté viva (inofensivo), pero conviene no usar la base de producción para desarrollo.

## Disparador para revisar
- Beta pública, o testers que se quejen del cold start → plan pago de Render en el mismo servicio (sin sleep; cumple el ADR 0006 original).
- Más de una instancia necesaria → revisar ADR 0004 (mesas en memoria) antes que el hosting.
