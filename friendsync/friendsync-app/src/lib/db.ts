/*
  db.ts — Auto-detecting DB adapter (native expo-sqlite or JS fallback)

  Schema (camelCase):
  - events: eventId (PK), date, description, endTime, eventTitle, isEvent, recurring, startTime, userId
  - friends: friendRowId (PK), userId, friendId, status
  - rsvps: rsvpId (PK), createdAt, eventId, eventOwnerId, inviteRecipientId, status, updatedAt
  - user_prefs: preferenceId (PK), userId, colorScheme, notificationEnabled, theme, updatedAt
  - users: userId (PK), email, username
  - notifications: notificationId (PK), notifMsg, userId, notifType, createdAt

  The adapter detects native expo-sqlite at runtime and uses it when available. Otherwise a JS-backed
  snapshot persisted via `src/lib/storage.ts` under key `fallback_db_v1` is used.
*/

import { Platform } from 'react-native';
import storage from './storage';

const FALLBACK_KEY = 'fallback_db_v1';

type Row = { [k: string]: any };

type DBShape = {
  __meta__: { nextId: { [table: string]: number } };
  users: Row[];
  friends: Row[];
  rsvps: Row[];
  user_prefs: Row[];
  events: Row[];
  notifications: Row[];
};

let nativeDb: any = null;
let useNative = false;
let initialized = false;

async function tryInitNative() {
  if (useNative || Platform.OS === 'web') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SQLite: any = require('expo-sqlite');
    let dbHandle: any = null;
    if (typeof SQLite.openDatabaseSync === 'function') dbHandle = SQLite.openDatabaseSync('friendsync.db');
    else if (typeof SQLite.openDatabase === 'function') dbHandle = SQLite.openDatabase('friendsync.db');

    if (dbHandle && typeof dbHandle.transaction === 'function') {
      nativeDb = dbHandle;
      useNative = true;
      // eslint-disable-next-line no-console
      console.log('db: using native expo-sqlite implementation');
    }
  } catch (e) {
    // ignore — fallback will be used
  }
}

async function loadFallback(): Promise<DBShape> {
  const val = await storage.getItem<any>(FALLBACK_KEY);
  if (!val) {
    const initial: DBShape = {
      __meta__: { nextId: {} },
      users: [],
      friends: [],
      rsvps: [],
      user_prefs: [],
      events: [],
      notifications: [],
    };
    await storage.setItem(FALLBACK_KEY, initial);
    return initial;
  }

  // Normalize/validate existing shape to avoid runtime undefineds from older or corrupted data
  const normalized: DBShape = {
    __meta__: (val.__meta__ && typeof val.__meta__ === 'object') ? val.__meta__ : { nextId: {} },
    users: Array.isArray(val.users) ? val.users : [],
    friends: Array.isArray(val.friends) ? val.friends : [],
    rsvps: Array.isArray(val.rsvps) ? val.rsvps : [],
    user_prefs: Array.isArray(val.user_prefs) ? val.user_prefs : [],
    events: Array.isArray(val.events) ? val.events : [],
    notifications: Array.isArray(val.notifications) ? val.notifications : [],
  };

  // Ensure __meta__.nextId exists and is an object
  if (!normalized.__meta__ || typeof normalized.__meta__ !== 'object') normalized.__meta__ = { nextId: {} };
  if (!normalized.__meta__.nextId || typeof normalized.__meta__.nextId !== 'object') normalized.__meta__.nextId = {};

  // Initialize missing nextId counters for known tables
  ['users', 'friends', 'rsvps', 'user_prefs', 'events', 'notifications'].forEach((tbl) => {
    if (normalized.__meta__.nextId[tbl] == null) {
      // compute a safe next id (max existing id + 1) if possible
      try {
        const arr = (normalized as any)[tbl] as any[];
        let max = 0;
        arr.forEach((r: any) => {
          const idKeys = Object.keys(r).filter(k => /id$/i.test(k));
          idKeys.forEach((k) => { const v = Number(r[k]); if (!Number.isNaN(v) && v > max) max = v; });
        });
        normalized.__meta__.nextId[tbl] = max + 1;
      } catch {
        normalized.__meta__.nextId[tbl] = 1;
      }
    }
  });

  // Persist a normalized copy back to storage to prevent repeated fixes
  try { await storage.setItem(FALLBACK_KEY, normalized); } catch (e) { /* non-fatal */ }

  return normalized;
}

async function saveFallback(db: DBShape) {
  await storage.setItem(FALLBACK_KEY, db);
}

function nextId(db: DBShape, table: keyof DBShape): number {
  const n = db.__meta__.nextId[table as string] ?? 1;
  db.__meta__.nextId[table as string] = n + 1;
  return n;
}

function execSqlNative(database: any, sql: string, params: any[] = []): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!database || typeof database.transaction !== 'function') return reject(new Error('Invalid native DB handle'));
    database.transaction((tx: any) => {
      tx.executeSql(sql, params, (_: any, result: any) => resolve(result), (_: any, err: any) => { reject(err); return false; });
    }, (txErr: any) => reject(txErr));
  });
}

async function createNativeTables() {
  if (!useNative || !nativeDb) return;
  await execSqlNative(nativeDb, `CREATE TABLE IF NOT EXISTS events (
    eventId INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    description TEXT,
    endTime TEXT,
    eventTitle TEXT,
    isEvent INTEGER,
    recurring INTEGER,
    startTime TEXT,
    userId INTEGER
  );`);

  await execSqlNative(nativeDb, `CREATE TABLE IF NOT EXISTS friends (
    friendRowId INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    friendId INTEGER,
    status TEXT
  );`);

  await execSqlNative(nativeDb, `CREATE TABLE IF NOT EXISTS rsvps (
    rsvpId INTEGER PRIMARY KEY AUTOINCREMENT,
    createdAt TEXT,
    eventId INTEGER,
    eventOwnerId INTEGER,
    inviteRecipientId INTEGER,
    status TEXT,
    updatedAt TEXT
  );`);

  await execSqlNative(nativeDb, `CREATE TABLE IF NOT EXISTS user_prefs (
    preferenceId INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    colorScheme INTEGER,
    notificationEnabled INTEGER,
    theme INTEGER,
    updatedAt TEXT
  );`);

  await execSqlNative(nativeDb, `CREATE TABLE IF NOT EXISTS users (
    userId INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    username TEXT
  );`);

  await execSqlNative(nativeDb, `CREATE TABLE IF NOT EXISTS notifications (
    notificationId INTEGER PRIMARY KEY AUTOINCREMENT,
    notifMsg TEXT,
    userId INTEGER,
    notifType TEXT,
    createdAt TEXT
  );`);
}

export async function init_db() {
  await tryInitNative();
  if (useNative) {
    try { await createNativeTables(); } catch (e) { useNative = false; await loadFallback(); }
  } else {
    await loadFallback();
  }
  initialized = true;
  return true;
}

export function getStatus() { return { initialized, backend: useNative ? 'native' : 'fallback' } }

export async function createUser(user: { username: string; email: string; password?: string; phone_number?: string | null; }): Promise<number> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'INSERT INTO users (email, username) VALUES (?, ?);', [user.email, user.username]);
    return res.insertId ?? 0;
  }
  const db = await loadFallback();
  const id = nextId(db, 'users');
  db.users.push({ userId: id, username: user.username, email: user.email });
  await saveFallback(db);
  return id;
}

export async function getUserById(id: number): Promise<any | null> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM users WHERE userId = ?;', [id]);
    return (res.rows && res.rows._array && res.rows._array[0]) ?? null;
  }
  const db = await loadFallback();
  return db.users.find(u => u.userId === id) ?? null;
}

export async function getUserByUsername(username: string): Promise<any | null> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM users WHERE username = ?;', [username]);
    return (res.rows && res.rows._array && res.rows._array[0]) ?? null;
  }
  const db = await loadFallback();
  return db.users.find(u => u.username === username) ?? null;
}

export async function getUserByEmail(email: string): Promise<any | null> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM users WHERE email = ?;', [email]);
    return (res.rows && res.rows._array && res.rows._array[0]) ?? null;
  }
  const db = await loadFallback();
  return db.users.find(u => u.email === email) ?? null;
}

export async function getAllUsers(): Promise<any[]> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM users;');
    return res.rows._array as any[];
  }
  const db = await loadFallback();
  return db.users.slice();
}

export async function updateUser(id: number, fields: { username?: string; email?: string; password?: string; phone_number?: string | null }) {
  await tryInitNative();
  if (useNative && nativeDb) {
    const sets: string[] = [];
    const params: any[] = [];
    if (fields.username !== undefined) { sets.push('username = ?'); params.push(fields.username); }
    if (fields.email !== undefined) { sets.push('email = ?'); params.push(fields.email); }
    if (sets.length === 0) return;
    params.push(id);
    const sql = `UPDATE users SET ${sets.join(', ')} WHERE userId = ?;`;
    await execSqlNative(nativeDb, sql, params);
    return;
  }
  const db = await loadFallback();
  const idx = db.users.findIndex(u => u.userId === id);
  if (idx === -1) return;
  db.users[idx] = { ...db.users[idx], ...fields };
  await saveFallback(db);
}

export async function deleteUser(id: number) {
  await tryInitNative();
  if (useNative && nativeDb) {
    await execSqlNative(nativeDb, 'DELETE FROM users WHERE userId = ?;', [id]);
    return;
  }
  const db = await loadFallback();
  db.users = db.users.filter(u => u.userId !== id);
  db.friends = db.friends.filter(r => r.userId !== id && r.friendId !== id);
  db.events = db.events.filter(e => e.userId !== id);
  db.rsvps = db.rsvps.filter(r => r.eventOwnerId !== id && r.inviteRecipientId !== id);
  db.notifications = db.notifications.filter(n => n.userId !== id);
  db.user_prefs = db.user_prefs.filter(p => p.userId !== id);
  await saveFallback(db);
}

// Friends
export async function sendFriendRequest(senderId: number, receiverId: number): Promise<number> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, "INSERT INTO friends (userId, friendId, status) VALUES (?, ?, 'pending');", [senderId, receiverId]);
    return res.insertId ?? 0;
  }
  const db = await loadFallback();
  const id = nextId(db, 'friends');
  db.friends.push({ friendRowId: id, userId: senderId, friendId: receiverId, status: 'pending' });
  await saveFallback(db);
  return id;
}

export async function respondFriendRequest(requestId: number, accept: boolean) {
  await tryInitNative();
  if (useNative && nativeDb) {
    const status = accept ? 'accepted' : 'rejected';
    await execSqlNative(nativeDb, 'UPDATE friends SET status = ? WHERE friendRowId = ?;', [status, requestId]);
    return;
  }
  const db = await loadFallback();
  const r = db.friends.find(rr => rr.friendRowId === requestId);
  if (!r) return;
  r.status = accept ? 'accepted' : 'rejected';
  await saveFallback(db);
}

export async function getFriendRequestsForUser(userId: number): Promise<any[]> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, "SELECT * FROM friends WHERE friendId = ? AND status = 'pending';", [userId]);
    return res.rows._array as any[];
  }
  const db = await loadFallback();
  return db.friends.filter(r => r.friendId === userId && r.status === 'pending');
}

export async function getFriendsForUser(userId: number): Promise<number[]> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, `
        SELECT userId, friendId FROM friends
        WHERE status = 'accepted' AND (userId = ? OR friendId = ?);
    `, [userId, userId]);
    return (res.rows._array as any[]).map((r) => (r.userId === userId ? r.friendId : r.userId) as number);
  }
  const db = await loadFallback();
  const accepted = db.friends.filter((r: any) => r.status === 'accepted' && (r.userId === userId || r.friendId === userId));
  return accepted.map((r: any) => (r.userId === userId ? r.friendId : r.userId));
}

export async function removeFriend(userA: number, userB: number) {
  await tryInitNative();
  if (useNative && nativeDb) {
    await execSqlNative(nativeDb, `
        DELETE FROM friends
        WHERE status = 'accepted' AND
            ((userId = ? AND friendId = ?) OR (userId = ? AND friendId = ?));
    `, [userA, userB, userB, userA]);
    return;
  }
  const db = await loadFallback();
  db.friends = db.friends.filter((r: any) => !(r.status === 'accepted' && ((r.userId === userA && r.friendId === userB) || (r.userId === userB && r.friendId === userA))));
  await saveFallback(db);
}

// RSVPs
export async function createRsvp(rsvp: { eventId: number; eventOwnerId: number; inviteRecipientId: number; status?: string; createdAt?: string; updatedAt?: string }): Promise<number> {
  await tryInitNative();
  const now = new Date().toISOString();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'INSERT INTO rsvps (createdAt, eventId, eventOwnerId, inviteRecipientId, status, updatedAt) VALUES (?, ?, ?, ?, ?, ?);', [rsvp.createdAt ?? now, rsvp.eventId, rsvp.eventOwnerId, rsvp.inviteRecipientId, rsvp.status ?? 'pending', rsvp.updatedAt ?? now]);
    return res.insertId ?? 0;
  }
  const db = await loadFallback();
  const id = nextId(db, 'rsvps');
  db.rsvps.push({ rsvpId: id, createdAt: rsvp.createdAt ?? now, eventId: rsvp.eventId, eventOwnerId: rsvp.eventOwnerId, inviteRecipientId: rsvp.inviteRecipientId, status: rsvp.status ?? 'pending', updatedAt: rsvp.updatedAt ?? now });
  await saveFallback(db);
  return id;
}

export async function getRsvpsForEvent(eventId: number): Promise<any[]> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM rsvps WHERE eventId = ? ORDER BY createdAt;', [eventId]);
    return res.rows._array as any[];
  }
  const db = await loadFallback();
  return db.rsvps.filter(r => r.eventId === eventId).sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function getRsvpsForUser(userId: number): Promise<any[]> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM rsvps WHERE inviteRecipientId = ? ORDER BY createdAt DESC;', [userId]);
    return res.rows._array as any[];
  }
  const db = await loadFallback();
  return db.rsvps.filter(r => r.inviteRecipientId === userId).sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function updateRsvp(rsvpId: number, fields: { status?: string; updatedAt?: string }) {
  await tryInitNative();
  const now = new Date().toISOString();
  if (useNative && nativeDb) {
    const sets: string[] = [];
    const params: any[] = [];
    if (fields.status !== undefined) { sets.push('status = ?'); params.push(fields.status); }
    params.push(fields.updatedAt ?? now);
    params.push(rsvpId);
    const sql = `UPDATE rsvps SET ${sets.join(', ')} , updatedAt = ? WHERE rsvpId = ?;`;
    await execSqlNative(nativeDb, sql, params);
    return;
  }
  const db = await loadFallback();
  const idx = db.rsvps.findIndex(r => r.rsvpId === rsvpId);
  if (idx === -1) return;
  db.rsvps[idx] = { ...db.rsvps[idx], ...fields, updatedAt: fields.updatedAt ?? now };
  await saveFallback(db);
}

export async function deleteRsvp(rsvpId: number) {
  await tryInitNative();
  if (useNative && nativeDb) {
    await execSqlNative(nativeDb, 'DELETE FROM rsvps WHERE rsvpId = ?;', [rsvpId]);
    return;
  }
  const db = await loadFallback();
  db.rsvps = db.rsvps.filter(r => r.rsvpId !== rsvpId);
  await saveFallback(db);
}

// Events
export async function createEvent(event: { userId: number; title?: string; eventTitle?: string; description?: string; startTime: string; endTime?: string; date?: string; isEvent?: number; recurring?: number }): Promise<number> {
  await tryInitNative();
  const title = event.eventTitle ?? event.title ?? null;
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'INSERT INTO events (userId, eventTitle, description, startTime, endTime, isEvent, recurring, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?);', [event.userId, title, event.description ?? null, event.startTime, event.endTime ?? null, event.isEvent ?? 1, event.recurring ?? 0, event.date ?? null]);
    return res.insertId ?? 0;
  }
  const db = await loadFallback();
  const id = nextId(db, 'events');
  db.events.push({ eventId: id, userId: event.userId, eventTitle: title, description: event.description ?? null, startTime: event.startTime, endTime: event.endTime ?? null, date: event.date ?? null, isEvent: event.isEvent ?? 1, recurring: event.recurring ?? 0 });
  await saveFallback(db);
  return id;
}

export async function getEventsForUser(userId: number): Promise<any[]> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM events WHERE userId = ? ORDER BY startTime;', [userId]);
    return res.rows._array as any[];
  }
  const db = await loadFallback();
  return db.events.filter(e => e.userId === userId).sort((a,b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

export async function deleteEvent(eventId: number) {
  await tryInitNative();
  if (useNative && nativeDb) {
    await execSqlNative(nativeDb, 'DELETE FROM events WHERE eventId = ?;', [eventId]);
    return;
  }
  const db = await loadFallback();
  db.events = db.events.filter(e => e.eventId !== eventId);
  await saveFallback(db);
}

export async function updateEvent(eventId: number, fields: { eventTitle?: string | null; description?: string | null; startTime?: string; endTime?: string | null; date?: string | null; recurring?: number | null; isEvent?: number | null; }) {
  await tryInitNative();
  if (useNative && nativeDb) {
    const sets: string[] = [];
    const params: any[] = [];
    if (fields.eventTitle !== undefined) { sets.push('eventTitle = ?'); params.push(fields.eventTitle); }
    if (fields.description !== undefined) { sets.push('description = ?'); params.push(fields.description); }
    if (fields.startTime !== undefined) { sets.push('startTime = ?'); params.push(fields.startTime); }
    if (fields.endTime !== undefined) { sets.push('endTime = ?'); params.push(fields.endTime); }
    if (fields.date !== undefined) { sets.push('date = ?'); params.push(fields.date); }
    if (fields.recurring !== undefined) { sets.push('recurring = ?'); params.push(fields.recurring); }
    if (fields.isEvent !== undefined) { sets.push('isEvent = ?'); params.push(fields.isEvent); }
    if (sets.length === 0) return;
    params.push(eventId);
    const sql = `UPDATE events SET ${sets.join(', ')} WHERE eventId = ?;`;
    await execSqlNative(nativeDb, sql, params);
    return;
  }
  const db = await loadFallback();
  const idx = db.events.findIndex(e => e.eventId === eventId);
  if (idx === -1) return;
  db.events[idx] = { ...db.events[idx], ...fields } as any;
  await saveFallback(db);
}

// Free time (stored as events with isEvent = 0)
export async function addFreeTime(slot: { userId: number; startTime: string; endTime?: string; }): Promise<number> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'INSERT INTO events (userId, startTime, endTime, isEvent) VALUES (?, ?, ?, 0);', [slot.userId, slot.startTime, slot.endTime ?? null]);
    return res.insertId ?? 0;
  }
  const db = await loadFallback();
  const id = nextId(db, 'events');
  db.events.push({ eventId: id, userId: slot.userId, startTime: slot.startTime, endTime: slot.endTime ?? null, isEvent: 0, eventTitle: null, description: null, date: null, recurring: 0 });
  await saveFallback(db);
  return id;
}

export async function getFreeTimeForUser(userId: number): Promise<any[]> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM events WHERE userId = ? AND isEvent = 0 ORDER BY startTime;', [userId]);
    return res.rows._array as any[];
  }
  const db = await loadFallback();
  return db.events.filter(f => f.userId === userId && (f.isEvent === 0 || f.isEvent === false)).sort((a,b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

// Notifications
export async function addNotification(note: { userId: number; notifMsg: string; notifType?: string; timestamp?: string; }): Promise<number> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'INSERT INTO notifications (userId, notifMsg, notifType, createdAt) VALUES (?, ?, ?, ?);', [note.userId, note.notifMsg, note.notifType ?? null, note.timestamp ?? new Date().toISOString()]);
    return res.insertId ?? 0;
  }
  const db = await loadFallback();
  const id = nextId(db, 'notifications');
  db.notifications.push({ notificationId: id, userId: note.userId, notifMsg: note.notifMsg, notifType: note.notifType ?? null, createdAt: note.timestamp ?? new Date().toISOString() });
  await saveFallback(db);
  return id;
}

export async function getNotificationsForUser(userId: number): Promise<any[]> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC;', [userId]);
    return res.rows._array as any[];
  }
  const db = await loadFallback();
  return db.notifications.filter(n => n.userId === userId).sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function clearNotificationsForUser(userId: number) {
  await tryInitNative();
  if (useNative && nativeDb) {
    await execSqlNative(nativeDb, 'DELETE FROM notifications WHERE userId = ?;', [userId]);
    return;
  }
  const db = await loadFallback();
  db.notifications = db.notifications.filter(n => n.userId !== userId);
  await saveFallback(db);
}

// Preferences
export async function setUserPreferences(userId: number, prefs: { theme?: number; notificationEnabled?: number; colorScheme?: number; }) {
  await tryInitNative();
  if (useNative && nativeDb) {
    const existing: any = await execSqlNative(nativeDb, 'SELECT * FROM user_prefs WHERE userId = ?;', [userId]);
    if ((existing.rows._array as any[]).length > 0) {
      const sets: string[] = [];
      const params: any[] = [];
      if (prefs.theme !== undefined) { sets.push('theme = ?'); params.push(prefs.theme); }
      if (prefs.notificationEnabled !== undefined) { sets.push('notificationEnabled = ?'); params.push(prefs.notificationEnabled); }
      if (prefs.colorScheme !== undefined) { sets.push('colorScheme = ?'); params.push(prefs.colorScheme); }
      if (sets.length === 0) return;
      params.push(new Date().toISOString());
      params.push(userId);
      await execSqlNative(nativeDb, `UPDATE user_prefs SET ${sets.join(', ')} , updatedAt = ? WHERE userId = ?;`, [...params]);
    } else {
      await execSqlNative(nativeDb, 'INSERT INTO user_prefs (userId, theme, notificationEnabled, colorScheme, updatedAt) VALUES (?, ?, ?, ?, ?);', [userId, prefs.theme ?? 0, prefs.notificationEnabled ?? 1, prefs.colorScheme ?? 0, new Date().toISOString()]);
    }
    return;
  }
  const db = await loadFallback();
  const idx = db.user_prefs.findIndex((p: any) => p.userId === userId);
  if (idx !== -1) {
    db.user_prefs[idx] = { ...db.user_prefs[idx], ...prefs, updatedAt: new Date().toISOString() };
  } else {
    db.user_prefs.push({ preferenceId: nextId(db, 'user_prefs'), userId, theme: prefs.theme ?? 0, notificationEnabled: prefs.notificationEnabled ?? 1, colorScheme: prefs.colorScheme ?? 0, updatedAt: new Date().toISOString() });
  }
  await saveFallback(db);
}

export async function getUserPreferences(userId: number): Promise<any | null> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM user_prefs WHERE userId = ?;', [userId]);
    return (res.rows._array as any[])[0] ?? null;
  }
  const db = await loadFallback();
  return db.user_prefs.find((p: any) => p.userId === userId) ?? null;
}

export default {
  init_db,
  
  // Users
  createUser,
  getUserById,
  getUserByUsername,
  updateUser,
  deleteUser,

  // Friends
  sendFriendRequest,
  respondFriendRequest,
  getFriendRequestsForUser,
  getFriendsForUser,
  removeFriend,

  // Events
  createEvent,
  getEventsForUser,
  deleteEvent,
  updateEvent,
  
  // Free time
  addFreeTime,
  getFreeTimeForUser,
  
  // Notifications
  addNotification,
  getNotificationsForUser,
  clearNotificationsForUser,
  
  // RSVPs
  createRsvp,
  getRsvpsForEvent,
  getRsvpsForUser,
  updateRsvp,
  deleteRsvp,
  
  // Preferences
  setUserPreferences,
  getUserPreferences,
  
  // New helpers
  getUserByEmail,
  getAllUsers,

  getStatus,
};


