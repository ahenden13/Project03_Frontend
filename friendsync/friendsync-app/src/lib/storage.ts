import { Platform } from 'react-native';

type StoredValue = any;

let backend: {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
  clear?: () => Promise<void>;
  keys?: () => Promise<string[]>;
} | null = null;

async function ensureBackend() {
  if (backend) return backend;

  if (Platform.OS === 'web') {
    const lf: any = await import('localforage');
    backend = {
      getItem: async (k: string) => (await lf.getItem(k)) as string | null,
      setItem: async (k: string, v: string) => {
        await lf.setItem(k, v);
      },
      removeItem: async (k: string) => lf.removeItem(k),
      clear: async () => lf.clear(),
      keys: async () => lf.keys(),
    };
  } else {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    backend = {
      getItem: AsyncStorage.getItem.bind(AsyncStorage),
      setItem: AsyncStorage.setItem.bind(AsyncStorage),
      removeItem: AsyncStorage.removeItem.bind(AsyncStorage),
      clear: AsyncStorage.clear ? AsyncStorage.clear.bind(AsyncStorage) : undefined,
      keys: AsyncStorage.getAllKeys ? AsyncStorage.getAllKeys.bind(AsyncStorage) : undefined,
    };
  }

  return backend;
}

export async function setItem(key: string, value: StoredValue): Promise<void> {
  const b = (await ensureBackend())!;
  await b.setItem(key, JSON.stringify(value));
}

export async function getItem<T = any>(key: string): Promise<T | null> {
  const b = (await ensureBackend())!;
  const raw = await b.getItem(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return (raw as unknown) as T;
  }
}

export async function removeItem(key: string): Promise<void> {
  const b = (await ensureBackend())!;
  await b.removeItem(key);
}

export async function clear(): Promise<void> {
  const b = (await ensureBackend())!;
  if (b.clear) await b.clear();
}

export async function keys(): Promise<string[]> {
  const b = (await ensureBackend())!;
  if (b.keys) return b.keys();
  return [];
}

export default { setItem, getItem, removeItem, clear, keys };
