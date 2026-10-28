import * as SecureStore from 'expo-secure-store';

// SecureStore warns above ~2048 bytes per value, so long values are split.
const CHUNK_SIZE = 1800;

const safe = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');
const countKey = (key: string) => `${safe(key)}.count`;
const chunkKey = (key: string, i: number) => `${safe(key)}.${i}`;

/** null = nothing stored; NaN = corrupt count. */
async function readCount(key: string): Promise<number | null> {
  const raw = await SecureStore.getItemAsync(countKey(key));
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}

export const chunkedSecureStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = await readCount(key);
    if (count === null || Number.isNaN(count)) return null;
    let out = '';
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      if (part === null) return null;
      out += part;
    }
    return out;
  },

  async setItem(key: string, value: string): Promise<void> {
    const previous = await readCount(key);
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) chunks.push(value.slice(i, i + CHUNK_SIZE));
    for (let i = 0; i < chunks.length; i++) {
      await SecureStore.setItemAsync(chunkKey(key, i), chunks[i] as string);
    }
    await SecureStore.setItemAsync(countKey(key), String(chunks.length));
    if (previous !== null && !Number.isNaN(previous)) {
      for (let i = chunks.length; i < previous; i++) {
        await SecureStore.deleteItemAsync(chunkKey(key, i));
      }
    }
  },

  async removeItem(key: string): Promise<void> {
    const count = await readCount(key);
    if (count !== null && !Number.isNaN(count)) {
      for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(chunkKey(key, i));
    }
    await SecureStore.deleteItemAsync(countKey(key));
  },
};
