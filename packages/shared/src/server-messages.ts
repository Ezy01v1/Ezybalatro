import type { TableClosed, TableDegraded, TableUpdate } from './table-protocol';

/**
 * Minimal structural guards for server→client messages (they have no Zod schemas): they only
 * check the shape the client relies on, so a malformed payload cannot crash the UI.
 */

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

export function isTableUpdate(x: unknown): x is TableUpdate {
  if (!isRecord(x)) return false;
  if (typeof x.tableId !== 'string') return false;
  if (typeof x.seq !== 'number' || !Number.isInteger(x.seq) || x.seq < 0) return false;
  if (!isRecord(x.view) || !Array.isArray(x.view.seats)) return false;
  if (!Array.isArray(x.events)) return false;
  if (x.turn !== null) {
    if (!isRecord(x.turn) || !isNumber(x.turn.seat) || !isNumber(x.turn.endsInMs)) return false;
  }
  return isRecord(x.names);
}

export function isTableClosed(x: unknown): x is TableClosed {
  return (
    isRecord(x) &&
    typeof x.tableId === 'string' &&
    (x.reason === 'empty' || x.reason === 'shutdown' || x.reason === 'error')
  );
}

export function isTableDegraded(x: unknown): x is TableDegraded {
  return isRecord(x) && typeof x.tableId === 'string' && typeof x.degraded === 'boolean';
}
