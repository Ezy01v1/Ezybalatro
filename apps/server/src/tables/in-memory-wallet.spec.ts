import { HouseBankroll, InMemoryWallet } from './in-memory-wallet';

describe('InMemoryWallet', () => {
  it('starts a new user with the initial balance', async () => {
    const w = new InMemoryWallet(1000);
    expect(await w.balance('a')).toBe(1000);
  });

  it('debit returns false and changes nothing when funds are short', async () => {
    const w = new InMemoryWallet(1000);
    expect(await w.debit('a', 1001)).toBe(false);
    expect(await w.balance('a')).toBe(1000);
    expect(await w.debit('a', 400)).toBe(true);
    expect(await w.balance('a')).toBe(600);
  });

  it('credit adds and total sums all users', async () => {
    const w = new InMemoryWallet(100);
    await w.credit('a', 50);
    await w.balance('b');
    expect(w.total()).toBe(250);
  });

  it('rejects non-positive or non-safe-integer amounts', async () => {
    const w = new InMemoryWallet(100);
    await expect(w.debit('a', 0)).rejects.toThrow(RangeError);
    await expect(w.credit('a', -1)).rejects.toThrow(RangeError);
    await expect(w.credit('a', 1.5)).rejects.toThrow(RangeError);
    await expect(w.debit('a', Number.MAX_SAFE_INTEGER + 1)).rejects.toThrow(RangeError);
  });
});

describe('HouseBankroll', () => {
  it('always debits and tracks outstanding chips', async () => {
    const h = new HouseBankroll();
    expect(await h.debit('bot', 500)).toBe(true);
    expect(h.outstanding).toBe(500);
    await h.credit('bot', 200);
    expect(h.outstanding).toBe(300);
  });
});
