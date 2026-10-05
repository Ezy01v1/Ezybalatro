#!/usr/bin/env node
/**
 * Balance simulation for the roguelike (Phase 2).
 *
 * A simple greedy bot plays N runs with different seeds using the real engine (packages/engine/dist):
 * - Blind: tries every combination of 1–5 cards in hand, scores it with the engine and plays the best.
 *   If the best hand cannot reach the target in the hands left and there are discards, it discards
 *   the cards that do not score in its best hand (lowest first).
 * - Shop: buys affordable jokers while it has slots, then level-ups for its most played hand type,
 *   keeps $5 of savings for interest when it can, and never rerolls.
 *
 * Usage: node packages/engine/scripts/simulate-balance.mjs [--runs 300] [--seed-prefix sim] [--json]
 * (run `pnpm build:packages` first, or use `pnpm sim:balance` from the root).
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const engine = require('../dist/index.js');
const { createRun, runReducer, scoreHand, isCardDebuffed, DEFAULT_RUN_CONFIG } = engine;

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const RUNS = Number(arg('runs', 300));
const PREFIX = arg('seed-prefix', 'sim');
const JSON_OUT = args.includes('--json');

/** Every combination of 1..5 cards, as arrays of indices. */
function combinations(n, maxK) {
  const out = [];
  const pick = (start, acc) => {
    if (acc.length > 0) out.push(acc.slice());
    if (acc.length === maxK) return;
    for (let i = start; i < n; i++) {
      acc.push(i);
      pick(i + 1, acc);
      acc.pop();
    }
  };
  pick(0, []);
  return out;
}
const COMBOS = new Map();
const combosFor = (n) => {
  if (!COMBOS.has(n)) COMBOS.set(n, combinations(n, Math.min(5, n)));
  return COMBOS.get(n);
};

function bestPlay(state) {
  let best = null;
  for (const combo of combosFor(state.hand.length)) {
    const played = combo.map((i) => state.hand[i]);
    const held = state.hand.filter((_, i) => !combo.includes(i));
    const result = scoreHand({
      played,
      held,
      jokers: state.jokers,
      handLevels: state.handLevels,
      handsPlayed: state.handsPlayed + 1,
      handsLeft: state.handsLeft - 1,
      discardsLeft: state.discardsLeft,
      money: state.money,
      isDebuffed: (card) => isCardDebuffed(state, card),
    });
    if (!best || result.score > best.score) best = { ...result, played };
  }
  return best;
}

function act(state, action) {
  const result = runReducer(state, action);
  if (!result.ok) throw new Error(`Bot made an illegal move ${action.type}: ${result.error.code}`);
  return result.state;
}

function playBlind(state, stats) {
  const best = bestPlay(state);
  const needed = state.target - state.roundScore;
  const canDiscard = state.discardsLeft > 0 && state.handsLeft > 1;
  if (best.score * state.handsLeft < needed && canDiscard) {
    const scoring = new Set(best.scoringCards.map((c) => c.id));
    const junk = state.hand
      .filter((c) => !scoring.has(c.id))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 5);
    if (junk.length > 0) return act(state, { type: 'discard', cardIds: junk.map((c) => c.id) });
  }
  stats.handTypes[best.handType] = (stats.handTypes[best.handType] ?? 0) + 1;
  stats.blindBest = Math.max(stats.blindBest, best.score);
  return act(state, { type: 'play', cardIds: best.played.map((c) => c.id) });
}

function shop(state, stats) {
  const favorite = Object.entries(stats.handTypes).sort((a, b) => b[1] - a[1])[0]?.[0];
  for (let i = 0; i < state.shop.length; i++) {
    const offer = state.shop[i];
    if (offer.sold || offer.price > state.money) continue;
    if (offer.kind === 'joker' && state.jokers.length < state.config.jokerSlots) {
      state = act(state, { type: 'buy', offerIndex: i });
    } else if (
      offer.kind === 'levelUp' &&
      offer.handType === favorite &&
      state.money - offer.price >= 5
    ) {
      state = act(state, { type: 'buy', offerIndex: i });
    }
  }
  return act(state, { type: 'leaveShop' });
}

function simulate(seed) {
  let state = createRun(seed).state;
  const stats = { handTypes: {}, blinds: [], blindBest: 0 };
  let guard = 0;
  while (state.status === 'in_progress') {
    if (++guard > 2000) throw new Error(`Run ${seed} did not finish`);
    if (state.phase === 'shop') {
      state = shop(state, stats);
      continue;
    }
    const blind = {
      ante: state.ante,
      blind: state.blind,
      bossId: state.bossId,
      target: state.target,
    };
    state = playBlind(state, stats);
    const blindOver =
      state.phase !== 'blind' || state.status !== 'in_progress' || state.blind !== blind.blind;
    if (blindOver) {
      stats.blinds.push({ ...blind, bestHand: stats.blindBest, won: state.status !== 'lost' });
      stats.blindBest = 0;
    }
  }
  return {
    seed,
    status: state.status,
    ante: state.ante,
    blind: state.blind,
    bossId: state.bossId,
    jokers: state.jokers.length,
    stats,
  };
}

const results = [];
for (let i = 0; i < RUNS; i++) results.push(simulate(`${PREFIX}-${i}`));

const deaths = {};
for (const r of results) {
  const key = r.status === 'won' ? 'won' : `${r.ante}-${r.blind}`;
  deaths[key] = (deaths[key] ?? 0) + 1;
}
const wins = results.filter((r) => r.status === 'won').length;
const bossFaced = {};
const bossDeaths = {};
for (const b of results.flatMap((r) => r.stats.blinds.filter((x) => x.blind === 'boss'))) {
  bossFaced[b.bossId] = (bossFaced[b.bossId] ?? 0) + 1;
  if (!b.won) bossDeaths[b.bossId] = (bossDeaths[b.bossId] ?? 0) + 1;
}
const anteReached = results.map((r) => (r.status === 'won' ? 9 : r.ante)).sort((a, b) => a - b);
const median = anteReached[Math.floor(anteReached.length / 2)];

const curve = [];
for (let ante = 1; ante <= DEFAULT_RUN_CONFIG.antes; ante++) {
  for (const blind of ['small', 'big', 'boss']) {
    const rows = results.flatMap((r) =>
      r.stats.blinds.filter((b) => b.ante === ante && b.blind === blind),
    );
    if (rows.length === 0) continue;
    const target = rows[0].target;
    const winRate = rows.filter((b) => b.won).length / rows.length;
    const avgBest = rows.reduce((s, b) => s + b.bestHand, 0) / rows.length;
    curve.push({
      ante,
      blind,
      target,
      attempts: rows.length,
      winRate,
      avgBestHand: Math.round(avgBest),
    });
  }
}

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      { runs: RUNS, wins, medianAnte: median, deaths, bossFaced, bossDeaths, curve },
      null,
      2,
    ),
  );
} else {
  const pct = (n) => `${((100 * n) / RUNS).toFixed(1)} %`;
  console.log(
    `Runs: ${RUNS} · ganadas: ${wins} (${pct(wins)}) · nivel mediano alcanzado: ${median === 9 ? 'ganó' : median}`,
  );
  console.log('\nDónde muere el bot:');
  const order = (k) =>
    k === 'won'
      ? 99
      : Number(k.split('-')[0]) * 3 + ['small', 'big', 'boss'].indexOf(k.split('-')[1]);
  for (const [k, n] of Object.entries(deaths).sort((a, b) => order(a[0]) - order(b[0]))) {
    console.log(`  ${k.padEnd(10)} ${String(n).padStart(4)}  ${pct(n)}`);
  }
  console.log('\nJefes (derrotas / veces enfrentado):');
  for (const [id, n] of Object.entries(bossFaced)) {
    const lost = bossDeaths[id] ?? 0;
    console.log(
      `  ${id.padEnd(10)} ${String(lost).padStart(4)} / ${String(n).padStart(4)}  ${((100 * lost) / n).toFixed(0)} %`,
    );
  }
  console.log('\nCurva por ciega (objetivo vs mejor mano promedio del bot):');
  console.log('  nivel ciega   objetivo  intentos  supera  mejor mano prom.');
  for (const c of curve) {
    console.log(
      `  ${String(c.ante).padStart(5)} ${c.blind.padEnd(6)} ${String(c.target).padStart(9)} ${String(c.attempts).padStart(9)} ${`${(c.winRate * 100).toFixed(0)}%`.padStart(7)} ${String(c.avgBestHand).padStart(17)}`,
    );
  }
}
