import type { PrismaClient } from '../generated/prisma/client';

export interface RecoveryResult {
  /** Seats removed by this run. */
  seats: number;
  /** Chips returned to wallets and to the house by this run. */
  chips: number;
}

/**
 * Startup recovery (spec §3.5, ADR 0004): the tables lived in the memory of a process that is gone,
 * so every seat still in the database goes back to its owner. One transaction per seat: the seat is
 * deleted first (`DELETE ... RETURNING`, which locks it), then its stack is credited to the wallet
 * (human) or returned to the house (bot, `user_id NULL`) with a `recovery_cash_out` ledger entry
 * keyed `recovery:<seat.id>`. A seat already deleted returns no row, so an interrupted or
 * concurrent second run never pays a seat twice. Finally every non-closed table is closed.
 */
export class RecoveryService {
  constructor(private readonly prisma: PrismaClient) {}

  async recover(): Promise<RecoveryResult> {
    const seats = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM seats ORDER BY created_at, id`;
    let count = 0;
    let chips = 0n;
    for (const { id } of seats) {
      const returned = await this.recoverSeat(id);
      if (returned === null) continue;
      count += 1;
      chips += returned;
    }
    await this.prisma.$executeRaw`
      UPDATE tables SET status = 'closed', closed_at = now() WHERE status <> 'closed'`;
    return { seats: count, chips: Number(chips) };
  }

  /** The stack returned, or null when another run already recovered the seat. */
  private recoverSeat(seatId: string): Promise<bigint | null> {
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.$queryRaw<{ table_id: string; user_id: string | null; stack: bigint }[]>`
        DELETE FROM seats WHERE id = ${seatId}::uuid
        RETURNING table_id::text AS table_id, user_id::text AS user_id, stack`;
      const seat = deleted[0];
      if (!seat) return null;
      if (seat.stack === 0n) return 0n; // the ledger never holds a zero delta
      const key = `recovery:${seatId}`;
      if (seat.user_id === null) {
        await tx.$executeRaw`
          INSERT INTO chip_ledger (id, user_id, delta, reason, table_id, idempotency_key)
          VALUES (gen_random_uuid(), NULL, ${seat.stack}, 'recovery_cash_out', ${seat.table_id}::uuid, ${key})`;
        return seat.stack;
      }
      const updated = await tx.$queryRaw<{ balance: bigint }[]>`
        UPDATE wallets SET balance = balance + ${seat.stack}
        WHERE user_id = ${seat.user_id}::uuid RETURNING balance`;
      const wallet = updated[0];
      if (!wallet) throw new Error('Recovery: seated user has no wallet');
      await tx.$executeRaw`
        INSERT INTO chip_ledger (id, user_id, delta, balance_after, reason, table_id, idempotency_key)
        VALUES (gen_random_uuid(), ${seat.user_id}::uuid, ${seat.stack}, ${wallet.balance},
                'recovery_cash_out', ${seat.table_id}::uuid, ${key})`;
      return seat.stack;
    });
  }
}
