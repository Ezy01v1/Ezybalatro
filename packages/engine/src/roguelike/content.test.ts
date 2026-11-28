import { describe, expect, it } from 'vitest';
import { HAND_CATEGORIES } from '../hands/hand-category';
import { CONSUMABLES, DEFAULT_CONTENT, EDITIONS, ENHANCEMENTS, PACKS, VOUCHERS } from './content';

const CARD_OPS = ['enhanceCards', 'changeSuit', 'shiftRank', 'destroyCards', 'duplicateCard'];

describe('consumables content', () => {
  it('has 22 entries (9 studies + 13 card consumables)', () => {
    expect(CONSUMABLES).toHaveLength(22);
  });

  it('has unique ids', () => {
    const ids = CONSUMABLES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('costs at least 1', () => {
    for (const c of CONSUMABLES) expect(c.cost).toBeGreaterThanOrEqual(1);
  });

  it('has valid target ranges or null', () => {
    for (const c of CONSUMABLES) {
      if (c.targets === null) continue;
      expect(c.targets.min).toBeGreaterThanOrEqual(1);
      expect(c.targets.min).toBeLessThanOrEqual(c.targets.max);
      expect(c.targets.max).toBeLessThanOrEqual(5);
    }
  });

  it('only enhances cards with existing enhancements', () => {
    const known = new Set(ENHANCEMENTS.map((e) => e.id));
    for (const c of CONSUMABLES) {
      for (const op of c.ops) {
        if (op.op === 'enhanceCards') expect(known.has(op.enhancement)).toBe(true);
      }
    }
  });

  it('has one study per hand category, exactly once', () => {
    const levelled = CONSUMABLES.flatMap((c) =>
      c.ops.flatMap((op) => (op.op === 'levelUpHand' ? [op.hand] : [])),
    );
    expect([...levelled].sort()).toEqual([...HAND_CATEGORIES].sort());
    for (const hand of HAND_CATEGORIES) {
      const study = CONSUMABLES.find((c) => c.id === `study_${hand}`);
      expect(study).toMatchObject({ cost: 3, targets: null, ops: [{ op: 'levelUpHand', hand }] });
    }
  });

  it('needs targets for card ops and none for levelUpHand', () => {
    for (const c of CONSUMABLES) {
      for (const op of c.ops) {
        if (CARD_OPS.includes(op.op)) expect(c.targets).not.toBeNull();
        if (op.op === 'levelUpHand') expect(c.targets).toBeNull();
      }
    }
  });

  it('allows duplicateCard only with a single target', () => {
    for (const c of CONSUMABLES) {
      if (c.ops.some((op) => op.op === 'duplicateCard')) {
        expect(c.targets?.max).toBe(1);
      }
    }
  });

  it('defines the expected enhancement, suit and other consumables', () => {
    const byId = new Map(CONSUMABLES.map((c) => [c.id, c]));
    const expectEnh: Array<[string, string, number]> = [
      ['reinforce', 'reinforced', 3],
      ['charge', 'charged', 4],
      ['gild', 'gilded', 3],
      ['weigh', 'heavy', 3],
      ['anchor_card', 'anchor', 4],
      ['volatilize', 'volatile', 5],
    ];
    for (const [id, enhancement, cost] of expectEnh) {
      expect(byId.get(id)).toEqual({
        id,
        cost,
        targets: { min: 1, max: 2 },
        ops: [{ op: 'enhanceCards', enhancement }],
      });
    }
    for (const suit of ['s', 'h', 'd', 'c'] as const) {
      expect(byId.get(`paint_${suit}`)).toEqual({
        id: `paint_${suit}`,
        cost: 3,
        targets: { min: 1, max: 3 },
        ops: [{ op: 'changeSuit', suit }],
      });
    }
    expect(byId.get('elevate')).toEqual({
      id: 'elevate',
      cost: 3,
      targets: { min: 1, max: 2 },
      ops: [{ op: 'shiftRank', delta: 1 }],
    });
    expect(byId.get('scrap')).toEqual({
      id: 'scrap',
      cost: 2,
      targets: { min: 1, max: 2 },
      ops: [{ op: 'destroyCards' }],
    });
    expect(byId.get('twin')).toEqual({
      id: 'twin',
      cost: 4,
      targets: { min: 1, max: 1 },
      ops: [{ op: 'duplicateCard' }],
    });
  });

  it('is wired into DEFAULT_CONTENT', () => {
    expect(DEFAULT_CONTENT.consumables).toBe(CONSUMABLES);
  });
});

describe('packs content', () => {
  it('has the 3 MVP packs with their ids, kinds and costs', () => {
    expect(PACKS.map((p) => [p.id, p.kind, p.cost, p.size, p.picks])).toEqual([
      ['pack_joker', 'joker', 6, 3, 1],
      ['pack_consumable', 'consumable', 4, 3, 1],
      ['pack_card', 'card', 5, 3, 1],
    ]);
  });

  it('has unique ids and picks within the size', () => {
    expect(new Set(PACKS.map((p) => p.id)).size).toBe(PACKS.length);
    for (const p of PACKS) {
      expect(p.picks).toBeGreaterThanOrEqual(1);
      expect(p.size).toBeGreaterThanOrEqual(p.picks);
    }
  });

  it('is wired into DEFAULT_CONTENT', () => {
    expect(DEFAULT_CONTENT.packs).toBe(PACKS);
  });
});

describe('vouchers content', () => {
  it('has the 6 MVP vouchers with their ids, costs and modifiers', () => {
    expect(VOUCHERS.map((v) => [v.id, v.cost, v.modifiers])).toEqual([
      ['extra_hand', 10, [{ key: 'hands', delta: 1 }]],
      ['extra_discard', 8, [{ key: 'discards', delta: 1 }]],
      ['joker_slot', 10, [{ key: 'jokerSlots', delta: 1 }]],
      ['consumable_slot', 6, [{ key: 'consumableSlots', delta: 1 }]],
      ['cheap_reroll', 6, [{ key: 'rerollBaseCost', delta: -1 }]],
      ['interest_cap', 8, [{ key: 'interestCap', delta: 1 }]],
    ]);
  });

  it('has unique ids and non-empty, non-zero modifiers', () => {
    expect(new Set(VOUCHERS.map((v) => v.id)).size).toBe(VOUCHERS.length);
    for (const v of VOUCHERS) {
      expect(v.modifiers.length).toBeGreaterThanOrEqual(1);
      for (const m of v.modifiers) expect(m.delta).not.toBe(0);
    }
  });

  it('is wired into DEFAULT_CONTENT', () => {
    expect(DEFAULT_CONTENT.vouchers).toBe(VOUCHERS);
  });
});

describe('editions content', () => {
  it('has foil, holo, poly and ample with unique ids and positive surcharges', () => {
    expect(EDITIONS.map((e) => e.id)).toEqual(['foil', 'holo', 'poly', 'ample']);
    for (const e of EDITIONS) expect(Number.isInteger(e.cost) && e.cost > 0).toBe(true);
  });

  it('each edition scores something or opens a slot', () => {
    for (const e of EDITIONS) {
      expect(e.effect !== undefined || (e.extraJokerSlots ?? 0) > 0).toBe(true);
    }
  });

  it('is part of the default content', () => {
    expect(DEFAULT_CONTENT.editions).toBe(EDITIONS);
  });
});
