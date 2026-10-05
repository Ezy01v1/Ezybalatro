#!/usr/bin/env node
/**
 * Finds a seed whose opening hand beats the first blind with a single play, for the Maestro flow
 * (apps/mobile/.maestro/roguelike-first-blind.yaml). Prints the seed, the cards to tap and the score.
 * Usage: pnpm build:packages && node packages/engine/scripts/find-e2e-seed.mjs [prefix]
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createRun, runReducer } = require('../dist/index.js');
const prefix = process.argv[2] ?? 'E2E';

function combinations(n) {
  const out = [];
  const pick = (start, acc) => {
    if (acc.length > 0) out.push(acc.slice());
    if (acc.length === 5) return;
    for (let i = start; i < n; i++) {
      acc.push(i);
      pick(i + 1, acc);
      acc.pop();
    }
  };
  pick(0, []);
  return out;
}

for (let i = 0; i < 1000; i++) {
  const seed = `${prefix}-${i}`;
  const { state } = createRun(seed);
  let best = null;
  for (const combo of combinations(state.hand.length)) {
    const cardIds = combo.map((k) => state.hand[k].id);
    const result = runReducer(state, { type: 'play', cardIds });
    const scored = result.events.find((e) => e.type === 'handScored');
    if (!best || scored.score > best.score)
      best = { score: scored.score, cardIds, handType: scored.handType };
  }
  if (best.score >= state.target) {
    console.log(`seed: ${seed}`);
    console.log(`hand: ${state.hand.map((c) => c.id).join(' ')}`);
    console.log(
      `tap:  ${best.cardIds.join(' ')} (${best.handType}, ${best.score} vs target ${state.target})`,
    );
    process.exit(0);
  }
}
console.error('No seed found');
process.exit(1);
