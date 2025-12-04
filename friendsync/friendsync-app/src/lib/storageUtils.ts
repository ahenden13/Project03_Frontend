import storage from './storage';

export async function dumpAll() {
  const keys = await storage.keys();
  const out: Record<string, any> = {};
  for (const k of keys) {
    out[k] = await storage.getItem(k as string);
  }
  return out;
}

export async function clearAll() {
  // Be conservative: remove keys we know the app uses plus clear if available
  const known = ['fallback_db_v1', 'navigation_state_v1', 'auth_token'];
  for (const k of known) {
    await storage.removeItem(k);
  }
  // finally try a full clear
  if (typeof storage.clear === 'function') {
    try { await storage.clear(); } catch (_) {}
  }
}

export async function exportKey(key: string) {
  return storage.getItem(key);
}

export default { dumpAll, clearAll, exportKey };
