# 0005. Base de datos y auth: Supabase (Postgres + Auth); el backend es el único cliente de datos
Estado: Aceptado
Fecha: 2026-10-03

## Contexto
Necesitamos Postgres, una cuenta de invitado al primer arranque, la posibilidad de vincular después Google/Apple/email **conservando el mismo usuario** (progreso y wallet), borrado de cuenta desde la app (Apple lo exige) y planes gratuitos al inicio, todo con un solo dev. El roguelike funciona offline: el invitado se crea cuando hay red y nunca bloquea jugar.

## Opciones consideradas
1. **Supabase (Postgres + Auth)**
   - Sign-in anónimo y vinculación de identidades (`linkIdentity` para OAuth, `updateUser` para email) que vuelven permanente al anónimo con el mismo `user.id`. *Verificar* en la doc vigente: el requisito de habilitar "manual linking" y qué pasa si la identidad ya pertenece a otro usuario.
   - Apple/Google nativos con `signInWithIdToken` (*verificar* el flujo con expo-apple-authentication y Google Sign-In).
   - Borrado con `auth.admin.deleteUser` desde el servidor.
   - Contras: acoplamiento a la plataforma; los proyectos gratuitos pueden pausarse por inactividad (*verificar* la política vigente).
2. **Neon + auth propia o una librería (p. ej. Better Auth)**
   - Postgres puro con branching (útil en CI); escala a cero con arranque en frío (*verificar*).
   - Contras: invitado, vinculación, Apple/Google, rotación de tokens y borrado hay que construirlos y asegurarlos. Es más superficie de seguridad para un dev solo.

## Decisión
**Supabase**, usando solo **Postgres y Auth**:
- El cliente móvil usa `@supabase/supabase-js` **solo para auth** (anon key) y guarda la sesión en expo-secure-store.
- Todos los datos pasan por NestJS, que verifica el JWT de Supabase y se conecta a Postgres (pooled para la app, directa para migraciones).
- RLS activado en todas las tablas, sin políticas para `anon`/`authenticated`, como defensa en profundidad. No hay acceso directo a tablas desde el cliente ni Supabase Realtime.
- `profiles.id` = `auth.users.id`.

**ORM: Prisma** (elegido por el usuario el 2026-10-03, por DX y migraciones). Reglas para usarlo:
- Movimientos de fichas con `updateMany({ where: { userId, balance: { gte: x } }, data: { balance: { decrement: x } } })` y chequeo de `count`, o `$queryRaw` con tagged template, dentro de `$transaction`. Nunca leer → calcular → escribir (invariante 7).
- `CHECK (balance >= 0)` y otras constraints que Prisma no modela se agregan a mano en la migración SQL.
- Versión: al 2026-10-03 el dist-tag `latest` de npm apunta a `8.0.0-rc.19` (una RC). Se usa la última estable (7.x, *verificar* al instalar). Prisma 7 usa `prisma.config.ts` y driver adapters (`@prisma/adapter-pg`); *verificar* en la doc la configuración con el pooler de Supabase (modo transacción) y la URL directa para migraciones.
- Se instala en la Fase 3, cuando exista el primer schema. En la Fase 0 no hay BD.

## Consecuencias
- Invitado → cuenta permanente sin migrar datos.
- `DELETE /v1/me`: una transacción borra o anonimiza los datos propios y luego llama a `auth.admin.deleteUser`.
- Lock-in moderado: los datos son Postgres estándar; lo costoso de migrar sería la auth.

## Disparador para revisar
- La vinculación anónimo → Google/Apple no conserva el `user.id` en la práctica (probarlo en la Fase 3 antes de depender de ello).
- El costo de Supabase supera el presupuesto mensual.
