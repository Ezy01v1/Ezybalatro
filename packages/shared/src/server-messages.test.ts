import { describe, expect, it } from 'vitest';
import { isTableClosed, isTableDegraded, isTableUpdate } from './server-messages';

const update = {
  tableId: 't1',
  seq: 3,
  events: [],
  view: { seats: [] },
  turn: { seat: 1, endsInMs: 1000 },
  names: { p1: 'ana' },
};

describe('isTableUpdate', () => {
  it('accepts a well-formed update, with or without turn', () => {
    expect(isTableUpdate(update)).toBe(true);
    expect(isTableUpdate({ ...update, turn: null })).toBe(true);
  });
  it.each([
    ['null', null],
    ['missing tableId', { ...update, tableId: undefined }],
    ['negative seq', { ...update, seq: -1 }],
    ['fractional seq', { ...update, seq: 1.5 }],
    ['view without seats', { ...update, view: {} }],
    ['events not array', { ...update, events: {} }],
    ['turn without endsInMs', { ...update, turn: { seat: 1 } }],
    ['missing turn', { ...update, turn: undefined }],
    ['names array', { ...update, names: [] }],
  ])('rejects %s', (_name, value) => {
    expect(isTableUpdate(value)).toBe(false);
  });
});

describe('isTableClosed / isTableDegraded', () => {
  it('validate their shapes', () => {
    expect(isTableClosed({ tableId: 't', reason: 'empty' })).toBe(true);
    expect(isTableClosed({ tableId: 't', reason: 'boom' })).toBe(false);
    expect(isTableClosed('x')).toBe(false);
    expect(isTableDegraded({ tableId: 't', degraded: true })).toBe(true);
    expect(isTableDegraded({ tableId: 't', degraded: 'yes' })).toBe(false);
  });
});
