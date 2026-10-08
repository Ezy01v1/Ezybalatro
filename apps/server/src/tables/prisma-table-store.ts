import type { TableConfig } from '@naipes/engine';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { isBotId } from './table-state-helpers';
import { HandAlreadyPersistedError, type HandRecord, type SitDownResult, type TableStore } from './table-store';

type Tx = Prisma.TransactionClient;

/** Chips are `number` in the port and BIGINT in SQL; this is the only conversion point. */
function chips(amount: number, allowZero: boolean): bigint {
  if (!Number.isSafeInteger(amount) || amount < 0 || (!allowZero && amount === 0)) {
    throw new RangeError(`Invalid chip amount: ${amount}`);
  }
  return BigInt(amount);
}

function toNumber(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError(`Chip amount out of range: ${value}`);
  return n;
}

const botName = (playerId: string): string => playerId.slice('bot:'.length);

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

/**
 * `TableStore` on Postgres (spec §3.2). Every operation is one interactive transaction. Wallet
 * debits are a conditional `UPDATE ... WHERE balance >= x RETURNING balance` (invariant 7) and
 * every wallet/house movement gets its `chip_ledger` entry in the same transaction. Bots (`bot:`)
 * buy in from and cash out to the house (`user_id NULL` ledger entries).
 */
export class PrismaTableStore implements TableStore {
  constructor(private readonly prisma: PrismaClient) {}

  async balance(playerId: string): Promise<number> {
    if (isBotId(playerId)) return Number.MAX_SAFE_INTEGER;
    const rows = await this.prisma.$queryRaw<{ balance: bigint }[]>`
      SELECT w.balance FROM wallets w JOIN profiles p ON p.id = w.user_id
      WHERE p.dev_handle = ${playerId}`;
    const row = rows[0];
    if (!row) throw new Error(`No profile/wallet for ${playerId}`);
    return toNumber(row.balance);
  }

  async openTable(tableId: string, config: TableConfig): Promise<void> {
    await this.prisma.pokerTable.create({
      data: {
        id: tableId,
        status: 'open',
        maxSeats: config.maxSeats,
        smallBlind: chips(config.smallBlind, false),
        bigBlind: chips(config.bigBlind, false),
        minBuyIn: chips(config.minBuyIn, false),
        maxBuyIn: chips(config.maxBuyIn, false),
      },
    });
  }

  async closeTable(tableId: string): Promise<void> {
    await this.prisma.pokerTable.update({
      where: { id: tableId },
      data: { status: 'closed', closedAt: new Date() },
    });
  }

  async sitDown(a: { tableId: string; seat: number; playerId: string; buyIn: number }): Promise<SitDownResult> {
    const amount = chips(a.buyIn, false);
    return this.prisma.$transaction(async (tx) => {
      if (isBotId(a.playerId)) {
        await tx.chipLedger.create({
          data: { userId: null, delta: -amount, reason: 'bot_buy_in', tableId: a.tableId },
        });
        await tx.seat.create({
          data: { tableId: a.tableId, seatIndex: a.seat, botName: botName(a.playerId), stack: amount },
        });
        return 'ok';
      }
      const userId = await this.userId(tx, a.playerId);
      const rows = await tx.$queryRaw<{ balance: bigint }[]>`
        UPDATE wallets SET balance = balance - ${amount}
        WHERE user_id = ${userId}::uuid AND balance >= ${amount}
        RETURNING balance`;
      const row = rows[0];
      if (!row) return 'insufficient';
      await tx.chipLedger.create({
        data: { userId, delta: -amount, balanceAfter: row.balance, reason: 'buy_in', tableId: a.tableId },
      });
      await tx.seat.create({ data: { tableId: a.tableId, seatIndex: a.seat, userId, stack: amount } });
      return 'ok';
    });
  }

  async standUp(a: { tableId: string; seat: number; playerId: string; cashOut: number }): Promise<void> {
    const amount = chips(a.cashOut, true);
    await this.prisma.$transaction(async (tx) => {
      await this.freeSeat(tx, a.tableId, a.seat, a.playerId, amount, null);
    });
  }

  async persistHand(record: HandRecord): Promise<void> {
    // Validate and convert everything before touching the database.
    const actions = record.actions.map((x) => ({
      seq: x.seq,
      seatIndex: x.seat,
      street: x.street,
      type: x.type,
      amount: chips(x.amount, true),
    }));
    const stacks = record.stacks.map((s) => ({ seat: s.seat, stack: chips(s.stack, true) }));
    const leavers = record.leavers.map((l) => ({ ...l, amount: chips(l.cashOut, true) }));

    await this.prisma.$transaction(async (tx) => {
      // A previous attempt may have committed with its acknowledgement lost: report it, change nothing.
      const existing = await tx.hand.findFirst({
        where: { tableId: record.tableId, handNumber: record.handNumber },
        select: { id: true },
      });
      if (existing) {
        const unsavedLeavers: HandRecord['leavers'] = [];
        for (const l of record.leavers) {
          const held = await tx.seat.count({ where: await this.seatOwner(tx, record.tableId, l.seat, l.playerId) });
          if (held === 1) unsavedLeavers.push({ playerId: l.playerId, seat: l.seat, cashOut: l.cashOut });
        }
        throw new HandAlreadyPersistedError(record.tableId, record.handNumber, unsavedLeavers);
      }
      const hand = await tx.hand.create({
        data: {
          tableId: record.tableId,
          handNumber: record.handNumber,
          status: record.status,
          buttonSeat: record.buttonSeat,
          board: json(record.board),
          awards: json(record.awards),
          shownHands: json(record.shownHands),
          settledAt: new Date(),
        },
      });
      if (actions.length > 0) {
        await tx.handAction.createMany({ data: actions.map((x) => ({ ...x, handId: hand.id })) });
      }
      for (const s of stacks) {
        const { count } = await tx.seat.updateMany({
          where: { tableId: record.tableId, seatIndex: s.seat },
          data: { stack: s.stack },
        });
        if (count !== 1) throw new Error(`No seat ${s.seat} at table ${record.tableId}`);
      }
      for (const l of leavers) {
        await this.freeSeat(tx, record.tableId, l.seat, l.playerId, l.amount, hand.id);
      }
    });
  }

  // ------------------------------------------------------------ internals

  /** Programming error when missing: accounts are created on connect. */
  private async userId(tx: Tx, playerId: string): Promise<string> {
    const profile = await tx.profile.findUnique({ where: { devHandle: playerId }, select: { id: true } });
    if (!profile) throw new Error(`No profile for ${playerId}`);
    return profile.id;
  }

  /** Filter matching `seat` of `tableId` only while `playerId` holds it. */
  private async seatOwner(
    tx: Tx,
    tableId: string,
    seat: number,
    playerId: string,
  ): Promise<{ tableId: string; seatIndex: number; botName?: string; userId?: string }> {
    return isBotId(playerId)
      ? { tableId, seatIndex: seat, botName: botName(playerId) }
      : { tableId, seatIndex: seat, userId: await this.userId(tx, playerId) };
  }

  /** Deletes the seat held by `playerId` and credits its cash-out to the wallet or the house. */
  private async freeSeat(
    tx: Tx,
    tableId: string,
    seat: number,
    playerId: string,
    amount: bigint,
    handId: string | null,
  ): Promise<void> {
    const bot = isBotId(playerId);
    const where = await this.seatOwner(tx, tableId, seat, playerId);
    const userId = where.userId ?? null;
    const { count } = await tx.seat.deleteMany({ where });
    if (count !== 1) throw new Error(`Seat ${seat} of table ${tableId} is not held by ${playerId}`);
    if (amount === 0n) return; // nothing to move (ledger deltas are never zero)
    if (bot) {
      await tx.chipLedger.create({
        data: { userId: null, delta: amount, reason: 'bot_cash_out', tableId, handId },
      });
      return;
    }
    const rows = await tx.$queryRaw<{ balance: bigint }[]>`
      UPDATE wallets SET balance = balance + ${amount} WHERE user_id = ${userId}::uuid
      RETURNING balance`;
    const row = rows[0];
    if (!row) throw new Error(`No wallet for ${playerId}`);
    await tx.chipLedger.create({
      data: { userId, delta: amount, balanceAfter: row.balance, reason: 'cash_out', tableId, handId },
    });
  }
}
