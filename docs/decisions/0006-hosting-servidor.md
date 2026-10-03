# 0006. Hosting del servidor: PaaS con proceso persistente (proveedor a elegir en Fase 3)
Estado: Aceptado
Fecha: 2026-10-03

## Contexto
El servidor mantiene WebSockets y el estado de las mesas en memoria (ADR 0004). Necesita un proceso persistente de una sola instancia que no se duerma (un "sleep" mata las mesas). Nadie va a operar servidores a tiempo completo. El servidor recién hace falta en la Fase 3; el roguelike no depende de él.

## Opciones consideradas
1. **VPS + Nginx + PM2 (o Docker)**. Pros: más barato por recurso, control total, sin cold starts. Contras: TLS, parches, firewall y monitoreo quedan a cargo del dev. Además, el modo cluster de PM2 rompería el ADR 0004 (tiene que ser 1 proceso).
2. **PaaS con servicio persistente (Render, Railway, Fly.io)**. Pros: deploy desde GitHub, TLS, logs, health checks y rollback. Contras: más caro por recurso; los planes gratuitos suelen dormir el servicio (*verificar* cada uno), y el soporte y los timeouts de WebSockets varían según el proveedor (*verificar*).
3. **Serverless**. Descartado: no tiene proceso persistente.

## Decisión
PaaS con **1 instancia persistente, sin autoscaling ni sleep** (plan pago mínimo cuando haya beta pública). El proveedor se elige al empezar la Fase 3 comparando datos vigentes: precio de la instancia más chica sin sleep, soporte de WebSockets y región cercana a Latinoamérica, en la misma región que la BD. Deploy desde `main` con health check en `/health`.

## Consecuencias
- Cero operación de sistema operativo, a cambio de más costo por recurso.
- Deploys con drenado de mesas (ADR 0004).

## Disparador para revisar
- El costo supera el presupuesto o se necesitan más de 2 instancias → evaluar un VPS con Docker.
