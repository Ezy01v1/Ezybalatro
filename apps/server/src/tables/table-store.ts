import type { Card, PotAward, ShowdownHand, TableConfig } from '@naipes/engine';

export type SitDownResult = 'ok' | 'insufficient';

export type HandActionType =
  'post_blind' | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in' | 'timeout';

export interface HandActionRecord {
  seq: number;
  seat: number;
  street: 'preflop' | 'flop' | 'turn' | 'river';
  type: HandActionType;
  amount: number;
}

/** A settled or voided hand, as stored by `persistHand` (spec §3.2). */
export interface HandRecord {
  tableId: string;
  handNumber: number;
  status: 'settled' | 'voided';
  buttonSeat: number;
  board: Card[];
  awards: PotAward[];
  /** Only the hands shown at showdown: mucked cards never get here (invariant 4). */
  shownHands: ShowdownHand[];
  actions: HandActionRecord[];
  /** Seats still occupied after the hand. */
  stacks: { seat: number; stack: number }[];
  /** Players whose seat was freed with this hand; their cash-out is credited in the same transaction. */
  leavers: { playerId: string; seat: number; cashOut: number }[];
}

/**
 * Where table chips live (spec §3.2). Every operation is one transaction: it either applies whole or
 * throws having changed nothing. Bots (`bot:` ids) buy in from and cash out to the house.
 */
export interface TableStore {
  /** Wallet balance of a human player. */
  balance(playerId: string): Promise<number>;
  openTable(tableId: string, config: TableConfig): Promise<void>;
  closeTable(tableId: string): Promise<void>;
  sitDown(a: {
    tableId: string;
    seat: number;
    playerId: string;
    buyIn: number;
  }): Promise<SitDownResult>;
  standUp(a: { tableId: string; seat: number; playerId: string; cashOut: number }): Promise<void>;
  persistHand(record: HandRecord): Promise<void>;
}

/**
 * `persistHand` of a hand that is already stored (same table and hand number): a previous attempt
 * committed but its acknowledgement was lost. Nothing was changed by this call. `unsavedLeavers` are
 * the leavers of the given record whose seat is still held in the store (they were not part of the
 * committed record) and must still be stood up.
 */
export class HandAlreadyPersistedError extends Error {
  override readonly name = 'HandAlreadyPersistedError';
  constructor(
    readonly tableId: string,
    readonly handNumber: number,
    readonly unsavedLeavers: HandRecord['leavers'],
  ) {
    super(`Hand ${handNumber} of table ${tableId} is already persisted`);
  }
}
