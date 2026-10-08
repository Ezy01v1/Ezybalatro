import {
  BOT_PERSONALITY_IDS,
  createSeededRng,
  createStandardDeck,
  shuffleDeck,
  type BotPersonality,
} from '@naipes/engine';
import { join, makeRuntime, fixedDeckSource, type Harness } from '../tables/testing/table-harness';
import { BOT_NAMES } from './bot-names';
import { BotPlayer } from './bot-player';

const botId = (name: string) => `bot:${name}`;

function makeBot(h: Harness, name: string, delayMs = { min: 1000, max: 1000 }, seed = name) {
  return new BotPlayer(h.runtime, botId(name), 'normal', {
    scheduler: h.scheduler,
    rng: createSeededRng(seed),
    delayMs,
    logger: h.logger,
  });
}

async function seatBots(h: Harness, names: string[]) {
  for (const n of names) {
    const r = await h.runtime.sit(botId(n), 1000);
    if (!r.ok) throw new Error('sit failed');
  }
}

describe('BOT_NAMES', () => {
  it('has 20 unique letters-only names', () => {
    expect(BOT_NAMES).toHaveLength(20);
    expect(new Set(BOT_NAMES).size).toBe(20);
    for (const n of BOT_NAMES) expect(n).toMatch(/^[A-Za-z]+$/);
  });
});

describe('BotPlayer', () => {
  it('acts within the delay window and only on its turn', async () => {
    const h = makeRuntime();
    await seatBots(h, ['A', 'B']);
    const bots = [makeBot(h, 'A'), makeBot(h, 'B')];
    bots.forEach((b) => b.start());
    const act = jest.spyOn(h.runtime, 'act');

    await h.scheduler.advance(3000); // hand starts
    expect(h.runtime.isHandInProgress()).toBe(true);
    const view = h.runtime.snapshot('').view;
    const toAct = view.seats[view.hand!.toAct!]!.playerId;

    await h.scheduler.advance(999);
    expect(act).not.toHaveBeenCalled();
    await h.scheduler.advance(1);
    expect(act).toHaveBeenCalledTimes(1);
    expect(act.mock.calls[0]![0]).toBe(toAct);
    expect(act.mock.calls[0]![1]).toBeGreaterThan(0);
    bots.forEach((b) => b.stop());
  });

  it('re-decides immediately after STALE_SEQ', async () => {
    const h = makeRuntime();
    await seatBots(h, ['A', 'B']);
    const bots = [makeBot(h, 'A'), makeBot(h, 'B')];
    bots.forEach((b) => b.start());
    await h.scheduler.advance(3000);

    const act = jest.spyOn(h.runtime, 'act');
    // A human sits during the delay: queued ahead of the bot's act, so the seq moves under it.
    const sitting = join(h, 'human');
    await h.scheduler.advance(1000);
    await sitting;
    await h.scheduler.flush();

    expect(act.mock.calls.length).toBeGreaterThanOrEqual(2);
    const [first, second] = act.mock.calls;
    expect(second![1]).toBeGreaterThan(first![1]);
    const results = await Promise.all(act.mock.results.map((r) => r.value));
    expect(results[0]).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'STALE_SEQ' }),
    });
    expect(results[1]).toEqual({ ok: true });
    bots.forEach((b) => b.stop());
  });

  it('stops after it leaves', async () => {
    const h = makeRuntime();
    await seatBots(h, ['A', 'B', 'C']);
    const bots = [makeBot(h, 'A'), makeBot(h, 'B'), makeBot(h, 'C')];
    bots.forEach((b) => b.start());
    await h.runtime.leave(botId('A')); // between hands: leaves at once
    const act = jest.spyOn(h.runtime, 'act');
    await h.scheduler.advance(60_000);
    expect(act).toHaveBeenCalled();
    expect(act.mock.calls.some((c) => c[0] === botId('A'))).toBe(false);
    bots.forEach((b) => b.stop());
  });

  it('stop() cancels the pending decision', async () => {
    const h = makeRuntime();
    await seatBots(h, ['A', 'B']);
    const bots = [makeBot(h, 'A'), makeBot(h, 'B')];
    bots.forEach((b) => b.start());
    await h.scheduler.advance(3000);
    const pending = h.scheduler.pendingCount();
    const act = jest.spyOn(h.runtime, 'act');
    bots.forEach((b) => b.stop());
    expect(h.scheduler.pendingCount()).toBeLessThan(pending);
    await h.scheduler.advance(1000);
    expect(act).not.toHaveBeenCalled();
  });

  it('stops when the table closes', async () => {
    const h = makeRuntime();
    await seatBots(h, ['A', 'B']);
    const bots = [makeBot(h, 'A'), makeBot(h, 'B')];
    bots.forEach((b) => b.start());
    await h.scheduler.advance(3000);
    const act = jest.spyOn(h.runtime, 'act');
    await h.runtime.close('shutdown');
    expect(h.scheduler.pendingCount()).toBe(0);
    await h.scheduler.advance(60_000);
    expect(act).not.toHaveBeenCalled();
    expect(h.logger.error).not.toHaveBeenCalled();
  });

  it('a throwing decision is logged, never unhandled, and the turn timeout covers the bot', async () => {
    const h = makeRuntime();
    await seatBots(h, ['A', 'B']);
    let broken = false;
    const base = createSeededRng('broken');
    const rng = {
      nextUint32: () => {
        if (broken) throw new Error('rng exploded');
        return base.nextUint32();
      },
    };
    const bots = ['A', 'B'].map(
      (n) =>
        new BotPlayer(h.runtime, botId(n), 'normal', {
          scheduler: h.scheduler,
          rng,
          delayMs: { min: 1000, max: 1000 },
          logger: h.logger,
        }),
    );
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      bots.forEach((b) => b.start());
      await h.scheduler.advance(3000); // hand starts; delays already scheduled
      const seqBefore = h.runtime.snapshot('').seq;
      broken = true;
      await h.scheduler.advance(1000); // the bot decides and the decision throws
      await new Promise((resolve) => setImmediate(resolve));
      expect(h.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('rng exploded'),
        expect.any(String),
      );
      expect(unhandled).not.toHaveBeenCalled();
      // Nothing acted for the bot: the turn timeout does.
      await h.scheduler.advance(25_000);
      expect(h.runtime.snapshot('').seq).toBeGreaterThan(seqBefore);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
      bots.forEach((b) => b.stop());
    }
  });

  it('three bots play 50 hands alone without errors', async () => {
    const deckRng = createSeededRng('deck-seed');
    const h = makeRuntime({
      deckSource: fixedDeckSource(() => shuffleDeck(deckRng, createStandardDeck())),
    });
    const names = ['Rocio', 'Tano', 'Maru'];
    await seatBots(h, names);
    let settled = 0;
    const bots = names.map((n, i) => {
      const personality: BotPersonality = BOT_PERSONALITY_IDS[i % BOT_PERSONALITY_IDS.length]!;
      return new BotPlayer(h.runtime, botId(n), personality, {
        scheduler: h.scheduler,
        rng: createSeededRng(`bot-${n}`),
        delayMs: { min: 300, max: 900 },
        logger: h.logger,
      });
    });
    const unsubscribe = h.runtime.subscribe('observer', (m) => {
      if (m.type === 'update')
        settled += m.update.events.filter((e) => e.type === 'handSettled').length;
    });
    bots.forEach((b) => b.start());
    for (let i = 0; i < 4000 && settled < 50 && h.runtime.status !== 'closed'; i++) {
      await h.scheduler.advance(500);
    }
    unsubscribe();
    bots.forEach((b) => b.stop());
    expect(settled).toBeGreaterThanOrEqual(50);
    expect(h.logger.error).not.toHaveBeenCalled();
    expect(h.logger.warn).not.toHaveBeenCalled();
  });
});
