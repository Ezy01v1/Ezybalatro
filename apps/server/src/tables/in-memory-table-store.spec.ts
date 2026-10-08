import { InMemoryTableStore } from './in-memory-table-store';
import type { HandRecord } from './table-store';

const record = (over: Partial<HandRecord>): HandRecord => ({
  tableId: 't1',
  handNumber: 1,
  status: 'settled',
  buttonSeat: 0,
  board: [],
  awards: [],
  shownHands: [],
  actions: [],
  stacks: [],
  leavers: [],
  ...over,
});

describe('InMemoryTableStore', () => {
  it('sitDown debits the wallet or returns insufficient without changes', async () => {
    const store = new InMemoryTableStore({ initial: 1000 });
    expect(await store.sitDown({ tableId: 't1', seat: 0, playerId: 'ana', buyIn: 600 })).toBe('ok');
    expect(await store.balance('ana')).toBe(400);
    expect(await store.sitDown({ tableId: 't1', seat: 1, playerId: 'bob', buyIn: 1500 })).toBe(
      'insufficient',
    );
    expect(await store.balance('bob')).toBe(1000);
    expect(store.seatRows('t1')).toEqual([{ seat: 0, playerId: 'ana', stack: 600 }]);
  });

  it('bots sit with house chips and standUp returns them to the house', async () => {
    const store = new InMemoryTableStore({ initial: 1000 });
    await store.sitDown({ tableId: 't1', seat: 2, playerId: 'bot:x', buyIn: 2000 });
    expect(store.houseOutstanding()).toBe(2000);
    expect(store.total()).toBe(0);
    await store.standUp({ tableId: 't1', seat: 2, playerId: 'bot:x', cashOut: 1500 });
    expect(store.houseOutstanding()).toBe(500);
    expect(store.seatRows('t1')).toEqual([]);
  });

  it('persistHand credits leavers and keeps total + houseOutstanding + stacks constant', async () => {
    const store = new InMemoryTableStore({ initial: 1000 });
    await store.sitDown({ tableId: 't1', seat: 0, playerId: 'ana', buyIn: 1000 });
    await store.sitDown({ tableId: 't1', seat: 1, playerId: 'bot:x', buyIn: 1000 });
    await store.sitDown({ tableId: 't1', seat: 2, playerId: 'bob', buyIn: 500 });
    // Held chips minus what the house lent: constant.
    const held = () => store.total() + store.seatedTotal() - store.houseOutstanding();
    const before = held();
    await store.persistHand(
      record({
        stacks: [{ seat: 2, stack: 300 }],
        leavers: [
          { playerId: 'ana', seat: 0, cashOut: 1700 },
          { playerId: 'bot:x', seat: 1, cashOut: 500 },
        ],
      }),
    );
    expect(await store.balance('ana')).toBe(1700);
    expect(store.houseOutstanding()).toBe(500);
    expect(store.seatRows('t1')).toEqual([{ seat: 2, playerId: 'bob', stack: 300 }]);
    expect(held()).toBe(before);
    expect(store.persistedHands()).toHaveLength(1);
  });

  it('a failing operation changes nothing; failNext counts calls', async () => {
    const store = new InMemoryTableStore({ initial: 1000 });
    await store.sitDown({ tableId: 't1', seat: 0, playerId: 'ana', buyIn: 600 });
    store.failNext('persistHand', 2);
    const r = record({ leavers: [{ playerId: 'ana', seat: 0, cashOut: 600 }] });
    await expect(store.persistHand(r)).rejects.toThrow();
    await expect(store.persistHand(r)).rejects.toThrow();
    expect(await store.balance('ana')).toBe(400);
    await store.persistHand(r);
    expect(await store.balance('ana')).toBe(1000);
  });

  it('persistHand rejects a leaver who does not hold the seat, changing nothing', async () => {
    const store = new InMemoryTableStore({ initial: 1000 });
    await store.sitDown({ tableId: 't1', seat: 0, playerId: 'ana', buyIn: 600 });
    await expect(
      store.persistHand(
        record({
          stacks: [{ seat: 0, stack: 10 }],
          leavers: [{ playerId: 'bob', seat: 0, cashOut: 600 }],
        }),
      ),
    ).rejects.toThrow();
    expect(store.seatRows('t1')).toEqual([{ seat: 0, playerId: 'ana', stack: 600 }]);
  });
});
