import type { TableConfig } from '@naipes/engine';
import { isBotId } from './table-state-helpers';
import { HandAlreadyPersistedError, type HandRecord, type SitDownResult, type TableStore } from './table-store';

function assertChips(amount: number, allowZero: boolean): void {
  if (!Number.isSafeInteger(amount) || amount < 0 || (!allowZero && amount === 0)) {
    throw new RangeError(`Invalid chip amount: ${amount}`);
  }
}

interface SeatRow {
  playerId: string;
  stack: number;
}

/**
 * `TableStore` in memory, with the same semantics as the Postgres one (for unit tests and, until the
 * database is wired, local development). Each human starts with `initial` chips the first time they
 * are touched. Each operation validates everything before changing anything, like a transaction.
 */
export class InMemoryTableStore implements TableStore {
  private readonly wallets = new Map<string, number>();
  private readonly seats = new Map<string, SeatRow>();
  private readonly tables = new Map<string, 'open' | 'closed'>();
  private readonly hands: HandRecord[] = [];
  private readonly failures = new Map<keyof TableStore, number>();
  private lostAcks = 0;
  private house = 0;
  private readonly initial: number;

  constructor(opts: { initial: number }) {
    this.initial = opts.initial;
  }

  // ------------------------------------------------------------ test helpers

  /** Σ wallets. */
  total(): number {
    let sum = 0;
    for (const v of this.wallets.values()) sum += v;
    return sum;
  }

  /** Chips the house put on tables (bot buy-ins) and has not got back. */
  houseOutstanding(): number {
    return this.house;
  }

  /** Σ stacks of the stored seats. */
  seatedTotal(): number {
    let sum = 0;
    for (const s of this.seats.values()) sum += s.stack;
    return sum;
  }

  seatRows(tableId: string): { seat: number; playerId: string; stack: number }[] {
    const prefix = `${tableId}#`;
    return [...this.seats.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, row]) => ({ seat: Number(key.slice(prefix.length)), ...row }))
      .sort((a, b) => a.seat - b.seat);
  }

  tableStatus(tableId: string): 'open' | 'closed' | undefined {
    return this.tables.get(tableId);
  }

  persistedHands(): readonly HandRecord[] {
    return this.hands;
  }

  /** The next `times` calls of `op` throw without changing anything. */
  failNext(op: keyof TableStore, times = 1): void {
    this.failures.set(op, (this.failures.get(op) ?? 0) + times);
  }

  /** The next `times` successful `persistHand` calls apply and then throw (acknowledgement lost). */
  loseNextPersistAck(times = 1): void {
    this.lostAcks += times;
  }

  // ------------------------------------------------------------ TableStore

  async balance(playerId: string): Promise<number> {
    this.maybeFail('balance');
    return isBotId(playerId) ? Number.MAX_SAFE_INTEGER : this.wallet(playerId);
  }

  async openTable(tableId: string, _config: TableConfig): Promise<void> {
    this.maybeFail('openTable');
    this.tables.set(tableId, 'open');
  }

  async closeTable(tableId: string): Promise<void> {
    this.maybeFail('closeTable');
    this.tables.set(tableId, 'closed');
  }

  async sitDown(a: {
    tableId: string;
    seat: number;
    playerId: string;
    buyIn: number;
  }): Promise<SitDownResult> {
    this.maybeFail('sitDown');
    assertChips(a.buyIn, false);
    const key = seatKey(a.tableId, a.seat);
    if (this.seats.has(key)) throw new Error(`Seat ${a.seat} of table ${a.tableId} is taken`);
    if (isBotId(a.playerId)) {
      this.house += a.buyIn;
    } else {
      const balance = this.wallet(a.playerId);
      if (balance < a.buyIn) return 'insufficient';
      this.wallets.set(a.playerId, balance - a.buyIn);
    }
    this.seats.set(key, { playerId: a.playerId, stack: a.buyIn });
    return 'ok';
  }

  async standUp(a: {
    tableId: string;
    seat: number;
    playerId: string;
    cashOut: number;
  }): Promise<void> {
    this.maybeFail('standUp');
    assertChips(a.cashOut, true);
    const key = seatKey(a.tableId, a.seat);
    this.requireSeat(key, a.playerId);
    this.seats.delete(key);
    this.credit(a.playerId, a.cashOut);
  }

  async persistHand(record: HandRecord): Promise<void> {
    this.maybeFail('persistHand');
    if (this.hands.some((h) => h.tableId === record.tableId && h.handNumber === record.handNumber)) {
      const unsavedLeavers = record.leavers.filter(
        (l) => this.seats.get(seatKey(record.tableId, l.seat))?.playerId === l.playerId,
      );
      throw new HandAlreadyPersistedError(record.tableId, record.handNumber, unsavedLeavers);
    }
    // Validate everything first: all or nothing.
    for (const s of record.stacks) {
      assertChips(s.stack, true);
      if (!this.seats.has(seatKey(record.tableId, s.seat))) {
        throw new Error(`No seat ${s.seat} at table ${record.tableId}`);
      }
    }
    for (const l of record.leavers) {
      assertChips(l.cashOut, true);
      this.requireSeat(seatKey(record.tableId, l.seat), l.playerId);
    }
    for (const s of record.stacks) this.seats.get(seatKey(record.tableId, s.seat))!.stack = s.stack;
    for (const l of record.leavers) {
      this.seats.delete(seatKey(record.tableId, l.seat));
      this.credit(l.playerId, l.cashOut);
    }
    this.hands.push(structuredClone(record));
    if (this.lostAcks > 0) {
      this.lostAcks--;
      throw new Error('InMemoryTableStore: simulated lost persistHand acknowledgement');
    }
  }

  // ------------------------------------------------------------ internals

  private maybeFail(op: keyof TableStore): void {
    const left = this.failures.get(op) ?? 0;
    if (left <= 0) return;
    this.failures.set(op, left - 1);
    throw new Error(`InMemoryTableStore: simulated ${op} failure`);
  }

  private wallet(playerId: string): number {
    let value = this.wallets.get(playerId);
    if (value === undefined) {
      value = this.initial;
      this.wallets.set(playerId, value);
    }
    return value;
  }

  private credit(playerId: string, amount: number): void {
    if (isBotId(playerId)) this.house -= amount;
    else this.wallets.set(playerId, this.wallet(playerId) + amount);
  }

  private requireSeat(key: string, playerId: string): void {
    if (this.seats.get(key)?.playerId !== playerId) {
      throw new Error(`Seat ${key} is not held by the given player`);
    }
  }
}

const seatKey = (tableId: string, seat: number): string => `${tableId}#${seat}`;
