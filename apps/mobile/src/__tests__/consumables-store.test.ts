import {
  consumableSellValue,
  CONSUMABLES,
  ENHANCEMENTS,
  type RunCard,
  type RunState,
} from '@naipes/engine';
import Storage from 'expo-sqlite/kv-store';
import { loadRun } from '@/game/persistence';
import { useGame } from '@/game/store';
import { CONSUMABLE_TEXTS, ENHANCEMENT_TEXTS } from '@/i18n/es';

/** Starts a run and puts the given consumables in the inventory (ids c1, c2…). */
function setup(...consumableIds: string[]): RunState {
  useGame.getState().startRun('CONSUMABLES');
  const run = useGame.getState().run!;
  const withItems: RunState = {
    ...run,
    consumables: consumableIds.map((consumableId, i) => ({
      instanceId: `c${i + 1}`,
      consumableId,
    })),
  };
  useGame.setState({ run: withItems });
  return withItems;
}

const handIds = () => useGame.getState().run!.hand.map((c) => c.id);

describe('consumables in the game store', () => {
  beforeEach(() => {
    (Storage as unknown as { clear(): void }).clear();
    useGame.getState().exitRun();
  });

  it('targeting a consumable limits the selection to its max', () => {
    setup('paint_h');
    const ids = handIds();
    const store = useGame.getState();
    store.beginTargeting('c1');
    expect(useGame.getState().targeting).toEqual({ instanceId: 'c1' });
    expect(store.toggleCard(ids[0]!)).toBe('ok');
    expect(store.toggleCard(ids[1]!)).toBe('ok');
    expect(store.toggleCard(ids[2]!)).toBe('ok');
    expect(store.toggleCard(ids[3]!)).toBe('limit');
    expect(useGame.getState().selected).toHaveLength(3);
  });

  it('beginTargeting clears the selection made before', () => {
    setup('paint_h');
    const ids = handIds();
    useGame.getState().toggleCard(ids[0]!);
    useGame.getState().beginTargeting('c1');
    expect(useGame.getState().selected).toEqual([]);
  });

  it('applying with no cards returns INVALID_CARDS, changes nothing and keeps the mode', () => {
    const before = setup('paint_h');
    useGame.getState().beginTargeting('c1');
    expect(useGame.getState().applyConsumable('c1')).toBe('INVALID_CARDS');
    expect(useGame.getState().run).toEqual(before);
    expect(useGame.getState().targeting).toEqual({ instanceId: 'c1' });
  });

  it('applying with cards changes hand and deck, leaves the mode and saves the run', () => {
    const before = setup('paint_h');
    const target = before.hand.find((c) => c.suit !== 'h')!;
    const dealBefore = useGame.getState().dealCount;
    useGame.getState().beginTargeting('c1');
    useGame.getState().toggleCard(target.id);
    expect(useGame.getState().applyConsumable('c1')).toBeNull();

    const { run, selected, targeting, dealCount } = useGame.getState();
    expect(run!.consumables).toHaveLength(0);
    expect(run!.hand.find((c) => c.id === target.id)).toMatchObject({ id: target.id, suit: 'h' });
    expect(run!.deck.find((c) => c.id === target.id)).toMatchObject({ id: target.id, suit: 'h' });
    expect(selected).toEqual([]);
    expect(targeting).toBeNull();
    expect(dealCount).toBe(dealBefore + 1);
    const saved = loadRun();
    expect(saved.status).toBe('ok');
    if (saved.status === 'ok') expect(saved.run).toEqual(run);
  });

  it('sends the selected cards in hand order, not tapping order', () => {
    const before = setup('reinforce');
    const [a, b] = [before.hand[0]!, before.hand[1]!];
    useGame.getState().beginTargeting('c1');
    useGame.getState().toggleCard(b.id);
    useGame.getState().toggleCard(a.id);
    expect(useGame.getState().applyConsumable('c1')).toBeNull();
    const hand = useGame.getState().run!.hand;
    expect(hand.find((c: RunCard) => c.id === a.id)!.enhancement).toBe('reinforced');
    expect(hand.find((c: RunCard) => c.id === b.id)!.enhancement).toBe('reinforced');
  });

  it('re-applies the chosen sort after the hand is refilled', () => {
    const before = setup('scrap');
    useGame.getState().sortHand('rank');
    const target = useGame.getState().run!.hand[0]!;
    useGame.getState().beginTargeting('c1');
    useGame.getState().toggleCard(target.id);
    expect(useGame.getState().applyConsumable('c1')).toBeNull();
    const hand = useGame.getState().run!.hand;
    expect(hand).toHaveLength(before.hand.length);
    const ranks = hand.map((c) => c.rank);
    expect(ranks).toEqual([...ranks].sort((x, y) => y - x));
  });

  it('beginTargeting on a study does nothing', () => {
    setup('study_pair');
    useGame.getState().beginTargeting('c1');
    expect(useGame.getState().targeting).toBeNull();
  });

  it('beginTargeting ignores unknown instances and the shop phase', () => {
    const before = setup('paint_h');
    useGame.getState().beginTargeting('nope');
    expect(useGame.getState().targeting).toBeNull();
    useGame.setState({ run: { ...before, phase: 'shop' } });
    useGame.getState().beginTargeting('c1');
    expect(useGame.getState().targeting).toBeNull();
  });

  it('a study applied without targeting raises that hand level', () => {
    const before = setup('study_pair');
    expect(useGame.getState().applyConsumable('c1')).toBeNull();
    const run = useGame.getState().run!;
    expect(run.handLevels.pair).toBe(before.handLevels.pair + 1);
    expect(run.consumables).toHaveLength(0);
  });

  it('cancelTargeting clears the selection and the mode', () => {
    setup('paint_h');
    useGame.getState().beginTargeting('c1');
    useGame.getState().toggleCard(handIds()[0]!);
    useGame.getState().cancelTargeting();
    expect(useGame.getState().targeting).toBeNull();
    expect(useGame.getState().selected).toEqual([]);
  });

  it('play and discard are ignored while targeting', () => {
    const before = setup('paint_h');
    useGame.getState().beginTargeting('c1');
    useGame.getState().toggleCard(handIds()[0]!);
    useGame.getState().play();
    useGame.getState().discard();
    expect(useGame.getState().playback).toBeNull();
    expect(useGame.getState().run).toEqual(before);
    expect(useGame.getState().selected).toHaveLength(1);
  });

  it('sellConsumable adds the sell value and removes the instance', () => {
    const before = setup('paint_h', 'twin');
    const value = consumableSellValue(before.consumables[1]!);
    useGame.getState().sellConsumable('c2');
    const run = useGame.getState().run!;
    expect(run.money).toBe(before.money + value);
    expect(run.consumables.map((c) => c.instanceId)).toEqual(['c1']);
  });

  it('selling the targeted consumable leaves targeting; selling another keeps it', () => {
    setup('paint_h', 'twin');
    useGame.getState().beginTargeting('c1');
    useGame.getState().sellConsumable('c2');
    expect(useGame.getState().targeting).toEqual({ instanceId: 'c1' });
    useGame.getState().sellConsumable('c1');
    expect(useGame.getState().targeting).toBeNull();
    expect(useGame.getState().selected).toEqual([]);
  });

  it('startRun and exitRun clear targeting', () => {
    setup('paint_h');
    useGame.getState().beginTargeting('c1');
    useGame.getState().startRun('OTHER');
    expect(useGame.getState().targeting).toBeNull();
    setup('paint_h');
    useGame.getState().beginTargeting('c1');
    useGame.getState().exitRun();
    expect(useGame.getState().targeting).toBeNull();
  });

  it('abandon clears targeting', () => {
    setup('paint_h');
    useGame.getState().beginTargeting('c1');
    useGame.getState().abandon();
    expect(useGame.getState().targeting).toBeNull();
  });
});

describe('consumable and enhancement texts', () => {
  it.each(CONSUMABLES.map((c) => c.id))('%s has complete texts', (id) => {
    const text = CONSUMABLE_TEXTS[id];
    expect(text).toBeDefined();
    for (const field of ['name', 'kind', 'short', 'description'] as const) {
      expect(text![field].trim().length).toBeGreaterThan(0);
    }
  });

  it.each(ENHANCEMENTS.map((e) => e.id))('%s has an enhancement label', (id) => {
    const text = ENHANCEMENT_TEXTS[id];
    expect(text).toBeDefined();
    expect(text!.name.length).toBeGreaterThan(0);
    expect(text!.description.length).toBeGreaterThan(0);
    expect(text!.short.length).toBeLessThanOrEqual(3);
    expect(text!.short.length).toBeGreaterThan(0);
    expect(['scored', 'held']).toContain(text!.timing);
  });

  it('has no texts for ids that do not exist', () => {
    const ids = new Set(CONSUMABLES.map((c) => c.id));
    expect(Object.keys(CONSUMABLE_TEXTS).every((id) => ids.has(id))).toBe(true);
  });
});
