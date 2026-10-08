import { describe, expect, it } from 'vitest';
import {
  actRequestSchema,
  playerActionSchema,
  quickSeatRequestSchema,
  sitInRequestSchema,
  SOCKET_EVENTS,
  socketErrorCodeSchema,
  tableRequestSchema,
} from './index';

const act = (action: unknown) => actRequestSchema.safeParse({ tableId: 't', seq: 0, action });

describe('table protocol', () => {
  it.each([-1, 0, 1.5, '100', NaN, 2 ** 53])('rejects bet amount %p', (amount) => {
    expect(act({ type: 'bet', amount }).success).toBe(false);
  });

  it.each([-1, 0, 1.5, '100', NaN, 2 ** 53])('rejects raise target %p', (to) => {
    expect(act({ type: 'raise', to }).success).toBe(false);
  });

  it('rejects unknown action types and extra keys', () => {
    expect(act({ type: 'steal' }).success).toBe(false);
    expect(act({ type: 'fold', playerId: 'x' }).success).toBe(false);
    expect(
      actRequestSchema.safeParse({ tableId: 't', seq: 0, action: { type: 'fold' }, playerId: 'x' }).success,
    ).toBe(false);
  });

  it('accepts every valid action', () => {
    for (const action of [
      { type: 'fold' },
      { type: 'check' },
      { type: 'call' },
      { type: 'bet', amount: 50 },
      { type: 'raise', to: 200 },
      { type: 'allIn' },
    ]) {
      expect(playerActionSchema.safeParse(action).success).toBe(true);
      expect(act(action).success).toBe(true);
    }
  });

  it('validates seq and tableId', () => {
    expect(actRequestSchema.safeParse({ tableId: 't', seq: -1, action: { type: 'fold' } }).success).toBe(false);
    expect(actRequestSchema.safeParse({ tableId: '', seq: 0, action: { type: 'fold' } }).success).toBe(false);
    expect(actRequestSchema.safeParse({ tableId: 'x'.repeat(65), seq: 0, action: { type: 'fold' } }).success).toBe(
      false,
    );
  });

  it('validates quickSeat, table and sitIn requests', () => {
    expect(quickSeatRequestSchema.safeParse({}).success).toBe(true);
    expect(quickSeatRequestSchema.safeParse({ buyIn: 1000 }).success).toBe(true);
    expect(quickSeatRequestSchema.safeParse({ buyIn: 0 }).success).toBe(false);
    expect(quickSeatRequestSchema.safeParse({ buyIn: 10, playerId: 'x' }).success).toBe(false);
    expect(tableRequestSchema.safeParse({ tableId: 't' }).success).toBe(true);
    expect(tableRequestSchema.safeParse({ tableId: 't', extra: 1 }).success).toBe(false);
    expect(sitInRequestSchema.safeParse({ tableId: 't', postBlindsToEnter: true }).success).toBe(true);
    expect(sitInRequestSchema.safeParse({ tableId: 't', postBlindsToEnter: 'yes' }).success).toBe(false);
  });

  it('accepts the new socket error codes', () => {
    for (const code of [
      'INVALID_ACTION',
      'NOT_AT_TABLE',
      'INSUFFICIENT_CHIPS',
      'TABLE_CLOSED',
      'TABLE_FULL',
      'SESSION_REPLACED',
      'UNAUTHORIZED',
      'RATE_LIMITED',
    ]) {
      expect(socketErrorCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it('exposes the table events', () => {
    expect(SOCKET_EVENTS.ping).toBe('ping');
    expect(SOCKET_EVENTS.quickSeat).toBe('table:quickSeat');
    expect(SOCKET_EVENTS.tableUpdate).toBe('table:update');
    expect(SOCKET_EVENTS.sessionReplaced).toBe('session:replaced');
  });
});
