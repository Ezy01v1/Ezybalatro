# 0003. Engine compartido, puro y determinista en packages/engine
Estado: Aceptado
Fecha: 2026-10-03

## Contexto
Las reglas (cartas, evaluador de manos, scoring del roguelike, máquina de estados de Hold'em, botes laterales) se usan en dos lugares: el cliente (roguelike offline) y el servidor (mesa autoritativa). Las invariantes 1, 2, 5 y 6 de CLAUDE.md exigen determinismo y tests exhaustivos (property-based con fast-check).

## Opciones consideradas
1. **Paquete puro con reducers `(state, action) → state`**. Se testea sin mocks, se reproduce por semilla y es el mismo código en ambos lados. Contra: exige disciplina para no meter I/O.
2. **Reglas dentro de cada app**. Más rápido al inicio, pero las reglas se duplican y divergen. Descartado (CLAUDE.md lo prohíbe).
3. **Clases con estado mutable**. Más natural en OO, pero más difícil de serializar, reproducir y persistir.

## Decisión
`packages/engine` es TypeScript puro, sin dependencias de runtime. Tiene prohibido usar React, Nest, `node:*`, `Date`, `Math.random`, timers y `fetch`, y una regla de ESLint (`no-restricted-globals` / `no-restricted-imports`) lo hace cumplir solo en ese paquete.

**Inyección del RNG:**
```ts
export interface Rng { nextUint32(): number }
export function nextInt(rng: Rng, maxExclusive: number): number   // sin sesgo (por rechazo)
export function shuffle<T>(rng: Rng, items: readonly T[]): T[]    // Fisher-Yates
```
- Roguelike: `createSeededRng(seed)` vive dentro del engine (hash de la semilla → PRNG tipo sfc32/xoshiro128**). El estado del PRNG forma parte del estado serializable de la run, así que el determinismo se mantiene después de guardar y cargar. Habrá sub-streams por propósito (mazo, tienda, jefes) para que comprar algo no cambie las cartas que salen después (el detalle va en la Fase 1).
- Mesa: el servidor implementa `Rng` con `crypto.randomInt` y lo inyecta.

**Inyección del tiempo:** el engine no tiene noción del tiempo. Los timeouts de turno los mide el servidor y entran como una acción explícita (`{ type: 'TIMEOUT', seat }`). Si alguna regla necesita un instante, llega como dato dentro de la acción.

**Vistas redactadas:** `viewFor(state, seat)` en el engine, con tests, devuelve lo que puede ver cada asiento (invariante 4).

## Consecuencias
- Tests rápidos sin mocks. Replays y depuración: semilla + log de acciones reproducen cualquier run o mano.
- El servidor nunca serializa el estado completo hacia un cliente: solo `viewFor`.

## Disparador para revisar
- El puntaje del roguelike supera `Number.MAX_SAFE_INTEGER` en partidas normales → ADR de números grandes.
