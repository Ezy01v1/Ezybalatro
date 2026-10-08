import type { HoldemError } from '@naipes/engine';
import type { SocketError, SocketErrorCode } from '@naipes/shared';

export function socketError(code: SocketErrorCode, message: string): SocketError {
  return { type: 'error', code, message };
}

/** The engine guarantees `message` never carries cards. */
export function toSocketError(e: HoldemError): SocketError {
  switch (e.code) {
    case 'NOT_YOUR_TURN':
    case 'INVALID_AMOUNT':
      return socketError(e.code, e.message);
    case 'INVALID_BUY_IN':
      return socketError('INVALID_AMOUNT', e.message);
    case 'NOT_SEATED':
      return socketError('NOT_AT_TABLE', e.message);
    default:
      return socketError('INVALID_ACTION', e.message);
  }
}
