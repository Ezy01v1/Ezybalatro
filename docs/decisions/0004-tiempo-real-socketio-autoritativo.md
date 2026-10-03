# 0004. Tiempo real: gateway NestJS + Socket.IO, servidor autoritativo, una instancia en MVP
Estado: Aceptado
Fecha: 2026-10-03

## Contexto
Mesas de Hold'em de 2 a 6 jugadores, con eventos bidireccionales de baja latencia. Los clientes usan datos móviles y se desconectan seguido. El servidor es la única autoridad (invariante 3). El volumen inicial es bajo y desconocido.

## Opciones consideradas
1. **Gateway NestJS + Socket.IO**. Pros: reconexión, rooms, acks y fallback a long-polling, integrado en Nest. Contra: protocolo propio.
2. **`ws` puro**. Más liviano, pero reconexión, rooms y heartbeats hay que construirlos.
3. **Supabase Realtime**. No permite lógica autoritativa de juego. Descartado.
4. **Colyseus**. Trae rooms y sincronización, pero es otra pieza y otro modelo de estado cuando ya tenemos el engine puro.

## Decisión
Socket.IO en un gateway NestJS, con **una sola instancia**. El estado de cada mesa vive en memoria (`Map<tableId, TableRuntime>`). Cada mesa procesa sus acciones de a una, en orden, desde una cola por mesa.

- Cliente → servidor: intenciones `{ type, handId, seq, … }`. El servidor valida turno, monto, stack y `seq` (`STALE_SEQ` para duplicados o viejos).
- Servidor → cliente: solo `viewFor(state, seat)` y eventos.
- Reconexión: el cliente se re-autentica y recibe un snapshot de su vista. El asiento tiene un período de gracia; si vence en su turno, se hace fold automático y luego queda sitting out.

**Persistencia:** al liquidar cada mano, en una transacción, se guardan `hands`, `hand_actions` y los stacks de los asientos. Buy-in y cash-out se guardan al instante con `chip_ledger` (invariante 7).

**Reinicio a mitad de mano:** la mano en curso se anula. Los stacks persistidos son los del final de la mano anterior, así que nadie pierde fichas. Se informa en la UI y queda en los logs.

## Consecuencias
- Simple de operar y de razonar, sin estado distribuido.
- Cada deploy corta las mesas: se hacen con drenado (no se abren manos nuevas y se espera a que terminen las actuales, con un tope de tiempo).
- No hay alta disponibilidad. Aceptado para el MVP.

## Disparador para escalar
Cualquiera de estas señales, medida en producción:
- CPU sostenida > 60% o event-loop lag p99 > 100 ms en horas pico.
- Más de ~1.000 sockets concurrentes o ~150 mesas activas. Son cifras a validar con una prueba de carga con bots antes del lanzamiento, no una capacidad garantizada.
- Necesidad de hacer deploys sin cortar mesas.

**Cómo escalar:** `@socket.io/redis-adapter` para el broadcast entre instancias y **asignación de cada mesa a una sola instancia** (registro `tableId → instancia` y ruteo por mesa). El estado de una mesa nunca se comparte entre procesos.
