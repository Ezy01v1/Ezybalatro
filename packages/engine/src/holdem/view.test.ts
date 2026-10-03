import { describe, expect, it } from 'vitest';
import { viewFor } from '../index';
import { run, stackedDeck, tableWith } from '../testing/holdem-fixtures';

describe('viewFor', () => {
  const start = () => {
    const table = tableWith([100, 100, 100]);
    return run(table, {
      type: 'postBlinds',
      deck: stackedDeck(table, { 0: 'As Ah', 1: 'Ks Kh', 2: 'Qs Qh' }, '2c 7d 9h Jc 3s'),
    }).state;
  };

  it('shows only your own hole cards during the hand, and never the deck', () => {
    const view = viewFor(start(), 'p1');
    expect(view.mySeat).toBe(1);
    expect(view.hand!.players.map((p) => p.holeCards?.map((c) => c.id) ?? null)).toEqual([
      null,
      ['Ks', 'Kh'],
      null,
    ]);
    expect(view.hand).not.toHaveProperty('deck');
    expect(view.legal).toBeNull(); // p0 acts first
    expect(viewFor(start(), 'p0').legal).toMatchObject({ seat: 0, callAmount: 2 });
  });

  it('spectators see no hole cards', () => {
    const view = viewFor(start(), 'someone-else');
    expect(view.mySeat).toBeNull();
    expect(view.hand!.players.every((p) => p.holeCards === null)).toBe(true);
  });

  it('reveals hands shown at showdown but never folded ones', () => {
    const state = run(
      start(),
      { type: 'allIn', playerId: 'p0' },
      { type: 'fold', playerId: 'p1' },
      { type: 'call', playerId: 'p2' },
    ).state;
    expect(state.hand!.street).toBe('settled');
    const view = viewFor(state, 'p2');
    expect(view.hand!.players.map((p) => p.holeCards?.map((c) => c.id) ?? null)).toEqual([
      ['As', 'Ah'],
      null,
      ['Qs', 'Qh'],
    ]);
    expect(view.hand!.pot).toBe(201);
  });

  it('a hand won by folds reveals nothing', () => {
    const state = run(
      start(),
      { type: 'fold', playerId: 'p0' },
      { type: 'fold', playerId: 'p1' },
    ).state;
    expect(viewFor(state, 'p1').hand!.players.map((p) => p.holeCards?.length ?? null)).toEqual([
      null,
      2,
      null,
    ]);
  });
});
