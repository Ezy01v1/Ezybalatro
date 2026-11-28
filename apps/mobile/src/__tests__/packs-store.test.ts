import { createRun, DEFAULT_RUN_CONFIG, runReducer, type RunState } from '@naipes/engine';
import Storage from 'expo-sqlite/kv-store';
import { loadRun } from '@/game/persistence';
import { useGame } from '@/game/store';

const EASY = { ...DEFAULT_RUN_CONFIG, anteTargets: [1, 1, 1, 1, 1, 1, 1, 1], startingMoney: 50 };

/** A run in the shop with plenty of money, put straight into the store. */
function shopRun(): RunState {
  const created = createRun('PACKS-STORE', EASY).state;
  const result = runReducer(created, { type: 'play', cardIds: [created.hand[0]!.id] });
  if (!result.ok) throw new Error('the first hand should beat the blind');
  useGame.setState({ run: result.state });
  return result.state;
}

const packIndex = (run: RunState) => run.shop.findIndex((o) => o.kind === 'pack');

function openOne() {
  const run = shopRun();
  expect(useGame.getState().buy(packIndex(run))).toBeNull();
  return useGame.getState().run!;
}

describe('packs in the game store', () => {
  beforeEach(() => {
    (Storage as unknown as { clear(): void }).clear();
    useGame.getState().exitRun();
  });

  it('buying a pack opens it in the run', () => {
    const opened = openOne();
    expect(opened.openPack).not.toBeNull();
    expect(opened.openPack!.items.length).toBeGreaterThan(0);
  });

  it('picking an option returns null and closes a one-pick pack', () => {
    openOne();
    expect(useGame.getState().pickFromPack(0)).toBeNull();
    expect(useGame.getState().run!.openPack).toBeNull();
  });

  it('an option that does not exist returns INVALID_PACK_ITEM and changes nothing', () => {
    const opened = openOne();
    expect(useGame.getState().pickFromPack(99)).toBe('INVALID_PACK_ITEM');
    expect(useGame.getState().run).toBe(opened);
  });

  it('skipping closes the pack without taking anything', () => {
    const opened = openOne();
    useGame.getState().skipPack();
    const run = useGame.getState().run!;
    expect(run.openPack).toBeNull();
    expect([run.jokers, run.consumables, run.deck]).toEqual([
      opened.jokers,
      opened.consumables,
      opened.deck,
    ]);
  });

  it('the shop stays locked while a pack is open', () => {
    openOne();
    expect(useGame.getState().reroll()).toBe('PACK_OPEN');
    expect(useGame.getState().buy(0)).toBe('PACK_OPEN');
  });

  it('the open pack is saved with the run and loads back open', () => {
    const opened = openOne();
    const loaded = loadRun();
    expect(loaded.status).toBe('ok');
    if (loaded.status === 'ok') expect(loaded.run.openPack).toEqual(opened.openPack);
  });
});
