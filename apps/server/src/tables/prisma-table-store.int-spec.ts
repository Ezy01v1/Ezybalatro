import { randomUUID } from 'node:crypto';
import { makeCard, type TableConfig } from '@naipes/engine';
import {
  auditChips,
  createTestDatabase,
  seedProfile,
  type TestDatabase,
} from '../db/testing/test-database';
import { PrismaTableStore } from './prisma-table-store';
import { HandAlreadyPersistedError, type HandRecord } from './table-store';

const CONFIG: TableConfig = { maxSeats: 6, smallBlind: 5, bigBlind: 10, minBuyIn: 200, maxBuyIn: 1000 };

describe('PrismaTableStore', () => {
  let db: TestDatabase;
  let store: PrismaTableStore;
  let tableId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    store = new PrismaTableStore(db.prisma);
  });
  afterAll(async () => {
    await db?.stop();
  });
  beforeEach(async () => {
    await db.reset();
    tableId = randomUUID();
    await store.openTable(tableId, CONFIG);
  });

  const wallet = async (userId: string): Promise<bigint> =>
    (await db.prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance;
  const seats = () =>
    db.prisma.seat.findMany({ where: { tableId }, orderBy: { seatIndex: 'asc' } });

  function handRecord(over: Partial<HandRecord> = {}): HandRecord {
    return {
      tableId,
      handNumber: 1,
      status: 'settled',
      buttonSeat: 0,
      board: [makeCard(14, 's'), makeCard(13, 's'), makeCard(2, 'c'), makeCard(7, 'd'), makeCard(9, 'h')],
      awards: [{ amount: 40, eligibleSeats: [0, 1], winners: [{ seat: 0, amount: 40 }] }],
      shownHands: [],
      actions: [
        { seq: 1, seat: 0, street: 'preflop', type: 'post_blind', amount: 5 },
        { seq: 2, seat: 1, street: 'preflop', type: 'post_blind', amount: 10 },
        { seq: 3, seat: 0, street: 'preflop', type: 'call', amount: 5 },
        { seq: 4, seat: 1, street: 'preflop', type: 'check', amount: 0 },
      ],
      stacks: [
        { seat: 0, stack: 320 },
        { seat: 1, stack: 280 },
      ],
      leavers: [],
      ...over,
    };
  }

  it('opens and closes a table', async () => {
    const row = await db.prisma.pokerTable.findUniqueOrThrow({ where: { id: tableId } });
    expect(row).toMatchObject({ status: 'open', maxSeats: 6, smallBlind: 5n, bigBlind: 10n, closedAt: null });
    await store.closeTable(tableId);
    const closed = await db.prisma.pokerTable.findUniqueOrThrow({ where: { id: tableId } });
    expect(closed.status).toBe('closed');
    expect(closed.closedAt).toBeInstanceOf(Date);
  });

  it('balance reads the wallet and throws for an unknown dev handle', async () => {
    await seedProfile(db.prisma, 'dev:ana', 1000);
    await expect(store.balance('dev:ana')).resolves.toBe(1000);
    await expect(store.balance('dev:nobody')).rejects.toThrow(/profile/i);
  });

  it('sitDown with enough balance debits, writes buy_in and inserts the seat', async () => {
    const ana = await seedProfile(db.prisma, 'dev:ana', 1000);
    await expect(store.sitDown({ tableId, seat: 2, playerId: 'dev:ana', buyIn: 300 })).resolves.toBe('ok');
    expect(await wallet(ana)).toBe(700n);
    const entries = await db.prisma.chipLedger.findMany({ where: { reason: 'buy_in' } });
    expect(entries).toEqual([
      expect.objectContaining({ userId: ana, delta: -300n, balanceAfter: 700n, tableId }),
    ]);
    expect(await seats()).toEqual([
      expect.objectContaining({ seatIndex: 2, userId: ana, botName: null, stack: 300n }),
    ]);
    await auditChips(db.prisma);
  });

  it('sitDown without balance returns insufficient and changes nothing', async () => {
    const ana = await seedProfile(db.prisma, 'dev:ana', 100);
    await expect(store.sitDown({ tableId, seat: 0, playerId: 'dev:ana', buyIn: 300 })).resolves.toBe(
      'insufficient',
    );
    expect(await wallet(ana)).toBe(100n);
    expect(await db.prisma.chipLedger.count({ where: { reason: 'buy_in' } })).toBe(0);
    expect(await seats()).toEqual([]);
  });

  it('two concurrent sitDowns that exceed the balance: exactly one succeeds, balance never negative', async () => {
    const ana = await seedProfile(db.prisma, 'dev:ana', 500);
    const results = await Promise.all([
      store.sitDown({ tableId, seat: 0, playerId: 'dev:ana', buyIn: 300 }),
      store.sitDown({ tableId, seat: 1, playerId: 'dev:ana', buyIn: 300 }),
    ]);
    expect([...results].sort()).toEqual(['insufficient', 'ok']);
    expect(await wallet(ana)).toBe(200n);
    expect(await seats()).toHaveLength(1);
    await auditChips(db.prisma);
  });

  it('rejects invalid chip amounts', async () => {
    await seedProfile(db.prisma, 'dev:ana', 1000);
    await expect(store.sitDown({ tableId, seat: 0, playerId: 'dev:ana', buyIn: 0 })).rejects.toThrow(RangeError);
    await expect(store.sitDown({ tableId, seat: 0, playerId: 'dev:ana', buyIn: 1.5 })).rejects.toThrow(RangeError);
  });

  it('standUp deletes the seat, credits the wallet and writes cash_out', async () => {
    const ana = await seedProfile(db.prisma, 'dev:ana', 1000);
    await store.sitDown({ tableId, seat: 0, playerId: 'dev:ana', buyIn: 300 });
    await store.standUp({ tableId, seat: 0, playerId: 'dev:ana', cashOut: 450 });
    expect(await wallet(ana)).toBe(1150n);
    expect(await seats()).toEqual([]);
    const entries = await db.prisma.chipLedger.findMany({ where: { reason: 'cash_out' } });
    expect(entries).toEqual([
      expect.objectContaining({ userId: ana, delta: 450n, balanceAfter: 1150n, tableId }),
    ]);
  });

  it('standUp throws when the seat is not held by the player', async () => {
    await seedProfile(db.prisma, 'dev:ana', 1000);
    await expect(store.standUp({ tableId, seat: 0, playerId: 'dev:ana', cashOut: 10 })).rejects.toThrow();
  });

  it('bot sitDown/standUp write bot_buy_in/bot_cash_out with user_id null', async () => {
    await expect(store.balance('bot:Rita')).resolves.toBe(Number.MAX_SAFE_INTEGER);
    await expect(store.sitDown({ tableId, seat: 3, playerId: 'bot:Rita', buyIn: 500 })).resolves.toBe('ok');
    expect(await seats()).toEqual([
      expect.objectContaining({ seatIndex: 3, userId: null, botName: 'Rita', stack: 500n }),
    ]);
    await auditChips(db.prisma);
    await store.standUp({ tableId, seat: 3, playerId: 'bot:Rita', cashOut: 620 });
    const entries = await db.prisma.chipLedger.findMany({ orderBy: { createdAt: 'asc' } });
    expect(entries.map((e) => [e.reason, e.userId, e.delta, e.balanceAfter])).toEqual([
      ['bot_buy_in', null, -500n, null],
      ['bot_cash_out', null, 620n, null],
    ]);
    expect(await seats()).toEqual([]);
  });

  it('persistHand writes hand, actions and stacks in one transaction', async () => {
    await seedProfile(db.prisma, 'dev:ana', 1000);
    await store.sitDown({ tableId, seat: 0, playerId: 'dev:ana', buyIn: 300 });
    await store.sitDown({ tableId, seat: 1, playerId: 'bot:Rita', buyIn: 300 });
    const record = handRecord();
    await store.persistHand(record);

    const hand = await db.prisma.hand.findUniqueOrThrow({
      where: { tableId_handNumber: { tableId, handNumber: 1 } },
      include: { actions: { orderBy: { seq: 'asc' } } },
    });
    expect(hand).toMatchObject({ status: 'settled', buttonSeat: 0, shownHands: [] });
    expect(hand.board).toEqual(JSON.parse(JSON.stringify(record.board)));
    expect(hand.awards).toEqual(record.awards);
    expect(hand.settledAt).toBeInstanceOf(Date);
    expect(hand.actions.map((a) => [a.seq, a.seatIndex, a.street, a.type, a.amount])).toEqual([
      [1, 0, 'preflop', 'post_blind', 5n],
      [2, 1, 'preflop', 'post_blind', 10n],
      [3, 0, 'preflop', 'call', 5n],
      [4, 1, 'preflop', 'check', 0n],
    ]);
    expect((await seats()).map((s) => [s.seatIndex, s.stack])).toEqual([
      [0, 320n],
      [1, 280n],
    ]);
    await auditChips(db.prisma);
  });

  it('persistHand pays a human leaver and a bot leaver of the same hand to wallet and house', async () => {
    const ana = await seedProfile(db.prisma, 'dev:ana', 1000);
    await seedProfile(db.prisma, 'dev:beto', 1000);
    await store.sitDown({ tableId, seat: 0, playerId: 'dev:ana', buyIn: 300 });
    await store.sitDown({ tableId, seat: 1, playerId: 'bot:Rita', buyIn: 300 });
    await store.sitDown({ tableId, seat: 2, playerId: 'dev:beto', buyIn: 300 });
    await store.persistHand(
      handRecord({
        stacks: [{ seat: 2, stack: 260 }],
        leavers: [
          { playerId: 'dev:ana', seat: 0, cashOut: 340 },
          { playerId: 'bot:Rita', seat: 1, cashOut: 300 },
        ],
      }),
    );
    const hand = await db.prisma.hand.findFirstOrThrow({ where: { tableId } });
    expect(await wallet(ana)).toBe(1040n);
    expect((await seats()).map((s) => [s.seatIndex, s.stack])).toEqual([[2, 260n]]);
    const cashOuts = await db.prisma.chipLedger.findMany({
      where: { reason: { in: ['cash_out', 'bot_cash_out'] } },
      orderBy: { reason: 'asc' },
    });
    expect(cashOuts.map((e) => [e.reason, e.userId, e.delta, e.balanceAfter, e.handId, e.tableId])).toEqual([
      ['cash_out', ana, 340n, 1040n, hand.id, tableId],
      ['bot_cash_out', null, 300n, null, hand.id, tableId],
    ]);
    await auditChips(db.prisma);
  });

  it('persistHand of an already saved hand throws HandAlreadyPersistedError and changes nothing', async () => {
    const ana = await seedProfile(db.prisma, 'dev:ana', 1000);
    const beto = await seedProfile(db.prisma, 'dev:beto', 1000);
    await store.sitDown({ tableId, seat: 0, playerId: 'dev:ana', buyIn: 300 });
    await store.sitDown({ tableId, seat: 1, playerId: 'dev:beto', buyIn: 300 });
    await store.sitDown({ tableId, seat: 2, playerId: 'bot:Rita', buyIn: 300 });
    // The committed attempt: ana leaves with the hand.
    await store.persistHand(
      handRecord({
        stacks: [{ seat: 1, stack: 280 }, { seat: 2, stack: 300 }],
        leavers: [{ playerId: 'dev:ana', seat: 0, cashOut: 320 }],
      }),
    );
    const ledgerBefore = await db.prisma.chipLedger.count();
    // The retry also carries beto (a leave asked for afterwards) as leaver.
    const retry = store.persistHand(
      handRecord({
        stacks: [{ seat: 2, stack: 300 }],
        leavers: [
          { playerId: 'dev:ana', seat: 0, cashOut: 320 },
          { playerId: 'dev:beto', seat: 1, cashOut: 280 },
        ],
      }),
    );
    await expect(retry).rejects.toBeInstanceOf(HandAlreadyPersistedError);
    await expect(retry).rejects.toMatchObject({
      handNumber: 1,
      unsavedLeavers: [{ playerId: 'dev:beto', seat: 1, cashOut: 280 }],
    });
    expect(await db.prisma.hand.count()).toBe(1);
    expect(await db.prisma.chipLedger.count()).toBe(ledgerBefore);
    expect(await wallet(ana)).toBe(1020n);
    expect(await wallet(beto)).toBe(700n);
    expect((await seats()).map((s) => [s.seatIndex, s.stack])).toEqual([[1, 280n], [2, 300n]]);
    await auditChips(db.prisma);
  });

  it('persistHand is atomic: a failure mid-way leaves no partial rows', async () => {
    const ana = await seedProfile(db.prisma, 'dev:ana', 1000);
    await store.sitDown({ tableId, seat: 0, playerId: 'dev:ana', buyIn: 300 });
    await store.sitDown({ tableId, seat: 1, playerId: 'bot:Rita', buyIn: 300 });
    const ledgerBefore = await db.prisma.chipLedger.count();
    await expect(
      store.persistHand(
        handRecord({
          stacks: [
            { seat: 1, stack: 280 },
            { seat: 5, stack: 20 }, // no such seat
          ],
          leavers: [{ playerId: 'dev:ana', seat: 0, cashOut: 320 }],
        }),
      ),
    ).rejects.toThrow(/seat 5/i);
    // Fails after the human leaver was already credited: that credit must roll back too.
    await expect(
      store.persistHand(
        handRecord({
          stacks: [],
          leavers: [
            { playerId: 'dev:ana', seat: 0, cashOut: 320 },
            { playerId: 'bot:Ghost', seat: 1, cashOut: 280 }, // seat 1 is Rita's
          ],
        }),
      ),
    ).rejects.toThrow(/not held/i);
    expect(await db.prisma.hand.count()).toBe(0);
    expect(await db.prisma.handAction.count()).toBe(0);
    expect(await db.prisma.chipLedger.count()).toBe(ledgerBefore);
    expect(await wallet(ana)).toBe(700n);
    expect((await seats()).map((s) => [s.seatIndex, s.stack])).toEqual([
      [0, 300n],
      [1, 300n],
    ]);
    await auditChips(db.prisma);
  });

  it('no unshown hole card appears in any table', async () => {
    await seedProfile(db.prisma, 'dev:ana', 1000);
    await store.sitDown({ tableId, seat: 0, playerId: 'dev:ana', buyIn: 300 });
    await store.sitDown({ tableId, seat: 1, playerId: 'bot:Rita', buyIn: 300 });
    await store.sitDown({ tableId, seat: 2, playerId: 'bot:Leo', buyIn: 300 });
    // Seat 2 mucked Qh Jc (never handed to the store); seats 0 and 1 showed.
    const shown = [
      { seat: 0, holeCards: [makeCard(14, 'h'), makeCard(14, 'd')], category: 'three_of_a_kind', bestCards: [], value: 3 },
      { seat: 1, holeCards: [makeCard(8, 'c'), makeCard(8, 'd')], category: 'pair', bestCards: [], value: 1 },
    ] as unknown as HandRecord['shownHands'];
    await store.persistHand(
      handRecord({
        shownHands: shown,
        stacks: [
          { seat: 0, stack: 340 },
          { seat: 1, stack: 280 },
          { seat: 2, stack: 280 },
        ],
      }),
    );
    const dump = await db.prisma.$queryRaw<{ row: string }[]>`
      SELECT row_to_json(h)::text AS row FROM hands h
      UNION ALL SELECT row_to_json(a)::text FROM hand_actions a
      UNION ALL SELECT row_to_json(s)::text FROM seats s
      UNION ALL SELECT row_to_json(l)::text FROM chip_ledger l`;
    const text = dump.map((d) => d.row).join('\n');
    expect(text).toContain('"Ah"'); // shown cards are stored
    expect(text).not.toContain('"Qh"');
    expect(text).not.toContain('"Jc"');
  });

  it('auditChips holds after a sequence of operations', async () => {
    await seedProfile(db.prisma, 'dev:ana', 1000);
    await seedProfile(db.prisma, 'dev:beto', 800);
    await store.sitDown({ tableId, seat: 0, playerId: 'dev:ana', buyIn: 400 });
    await store.sitDown({ tableId, seat: 1, playerId: 'dev:beto', buyIn: 500 });
    await store.sitDown({ tableId, seat: 2, playerId: 'bot:Rita', buyIn: 600 });
    await auditChips(db.prisma);
    await store.persistHand(
      handRecord({
        stacks: [
          { seat: 0, stack: 500 },
          { seat: 1, stack: 450 },
          { seat: 2, stack: 550 },
        ],
      }),
    );
    await auditChips(db.prisma);
    await store.persistHand(
      handRecord({
        handNumber: 2,
        status: 'voided',
        stacks: [{ seat: 2, stack: 500 }],
        leavers: [
          { playerId: 'dev:ana', seat: 0, cashOut: 500 },
          { playerId: 'dev:beto', seat: 1, cashOut: 500 },
        ],
      }),
    );
    await auditChips(db.prisma);
    await store.standUp({ tableId, seat: 2, playerId: 'bot:Rita', cashOut: 500 });
    await store.closeTable(tableId);
    await auditChips(db.prisma);
    await expect(store.balance('dev:ana')).resolves.toBe(1100);
    await expect(store.balance('dev:beto')).resolves.toBe(800);
  });
});
