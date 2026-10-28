import { chunkedSecureStorage as storage } from '../auth/chunkedSecureStorage';

const mockMem = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockMem.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockMem.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockMem.delete(k)),
}));

beforeEach(() => mockMem.clear());

describe('chunkedSecureStorage', () => {
  it.each([0, 2048, 5 * 1024])('round-trips values of %i B', async (size) => {
    const value = 'x'.repeat(size);
    await storage.setItem('k', value);
    expect(await storage.getItem('k')).toBe(value);
    for (const v of mockMem.values()) expect(v.length).toBeLessThanOrEqual(1800);
  });

  it('removeItem deletes every chunk', async () => {
    await storage.setItem('k', 'y'.repeat(5000));
    await storage.removeItem('k');
    expect(mockMem.size).toBe(0);
    expect(await storage.getItem('k')).toBeNull();
  });

  it('returns null when a chunk is missing or the count is corrupt', async () => {
    await storage.setItem('k', 'z'.repeat(4000));
    mockMem.delete('k.1');
    expect(await storage.getItem('k')).toBeNull();
    mockMem.set('k.count', 'abc');
    expect(await storage.getItem('k')).toBeNull();
  });

  it('overwriting a long value with a short one leaves no stale chunks', async () => {
    await storage.setItem('k', 'a'.repeat(5000));
    await storage.setItem('k', 'short');
    expect([...mockMem.keys()].sort()).toEqual(['k.0', 'k.count']);
    expect(await storage.getItem('k')).toBe('short');
  });
});
