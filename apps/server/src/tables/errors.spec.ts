import type { HoldemErrorCode } from '@naipes/engine';
import type { SocketErrorCode } from '@naipes/shared';
import { socketError, toSocketError } from './errors';

describe('errors', () => {
  it('socketError builds the wire shape', () => {
    expect(socketError('RATE_LIMITED', 'slow')).toEqual({
      type: 'error',
      code: 'RATE_LIMITED',
      message: 'slow',
    });
  });

  const table: Array<[HoldemErrorCode, SocketErrorCode]> = [
    ['NOT_YOUR_TURN', 'NOT_YOUR_TURN'],
    ['INVALID_AMOUNT', 'INVALID_AMOUNT'],
    ['INVALID_BUY_IN', 'INVALID_AMOUNT'],
    ['NOT_SEATED', 'NOT_AT_TABLE'],
    ['INVALID_ACTION', 'INVALID_ACTION'],
    ['SEAT_TAKEN', 'INVALID_ACTION'],
    ['INVALID_SEAT', 'INVALID_ACTION'],
    ['ALREADY_SEATED', 'INVALID_ACTION'],
    ['HAND_IN_PROGRESS', 'INVALID_ACTION'],
    ['NO_HAND_IN_PROGRESS', 'INVALID_ACTION'],
    ['NOT_ENOUGH_PLAYERS', 'INVALID_ACTION'],
    ['INVALID_DECK', 'INVALID_ACTION'],
  ];

  it.each(table)('maps %s to %s and keeps the message', (from, to) => {
    expect(toSocketError({ code: from, message: 'msg' })).toEqual({
      type: 'error',
      code: to,
      message: 'msg',
    });
  });
});
