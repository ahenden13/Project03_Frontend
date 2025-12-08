/*
  db.ts — Auto-detecting DB adapter with Firebase sync integration
  
  This version automatically syncs all database operations to Firebase Firestore
  in addition to storing them locally. Firebase sync can be disabled if needed.

  Schema (camelCase):
  - events: eventId (PK), date, description, endTime, eventTitle, isEvent, recurring, startTime, userId
  - friends: friendRowId (PK), userId, friendId, status
  - rsvps: rsvpId (PK), createdAt, eventId, eventOwnerId, inviteRecipientId, status, updatedAt
  - user_prefs: preferenceId (PK), userId, colorScheme, notificationEnabled, theme, updatedAt
  - users: userId (PK), email, username
  - notifications: notificationId (PK), notifMsg, userId, notifType, createdAt

  The adapter detects native expo-sqlite at runtime and uses it when available. Otherwise a JS-backed
  snapshot persisted via `src/lib/storage.ts` under key `fallback_db_v1` is used.
  
  All operations automatically sync to Firebase Firestore unless Firebase sync is disabled.
*/

import { Platform } from 'react-native';
import storage from './storage';
import * as FirebaseSync from './firebaseSync';

// ⚠️ TEMPORARILY DISABLE FIREBASE SYNC TO STOP DUPLICATES
// FirebaseSync.setFirebaseSyncEnabled(false);  // ← ADD THIS LINE!

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

  // Normalize/validate existing shape
  const normalized: DBShape = {
    __meta__: (val.__meta__ && typeof val.__meta__ === 'object') ? val.__meta__ : { nextId: {} },
    users: Array.isArray(val.users) ? val.users : [],
    friends: Array.isArray(val.friends) ? val.friends : [],
    rsvps: Array.isArray(val.rsvps) ? val.rsvps : [],
    user_prefs: Array.isArray(val.user_prefs) ? val.user_prefs : [],
    events: Array.isArray(val.events) ? val.events : [],
    notifications: Array.isArray(val.notifications) ? val.notifications : [],
  };

  if (!normalized.__meta__ || typeof normalized.__meta__ !== 'object') normalized.__meta__ = { nextId: {} };
  if (!normalized.__meta__.nextId || typeof normalized.__meta__.nextId !== 'object') normalized.__meta__.nextId = {};

  ['users', 'friends', 'rsvps', 'user_prefs', 'events', 'notifications'].forEach((tbl) => {
    if (normalized.__meta__.nextId[tbl] == null) {
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

// ============================================================================
// USERS
// ============================================================================

export async function createUser(user: { 
  username: string; 
  email: string; 
  password?: string; 
  phone_number?: string | null;
  firebaseUid?: string; // ← ADD THIS
}): Promise<number> {
  await tryInitNative();
  let userId: number;
  
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'INSERT INTO users (email, username) VALUES (?, ?);', [user.email, user.username]);
    userId = res.insertId ?? 0;
  } else {
    const db = await loadFallback();
    userId = nextId(db, 'users');
    db.users.push({ userId, username: user.username, email: user.email });
    await saveFallback(db);
  }
  
  // Sync to Firebase with Firebase UID
  if (FirebaseSync.isFirebaseSyncEnabled() && userId) {
    try {
      await FirebaseSync.syncUserToFirebase({ 
        ...user, 
        userId,
        firebaseUid: user.firebaseUid // ← PASS THE FIREBASE UID
      });
    } catch (error) {
      console.warn('Failed to sync user to Firebase:', error);
    }
  }
  
  return userId;
}

export async function getUserById(userId: number): Promise<any | null> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM users WHERE userId = ?;', [userId]);
    return (res.rows._array as any[])[0] ?? null;
  }
  const db = await loadFallback();
  return db.users.find((u: any) => u.userId === userId) ?? null;
}

export async function getUserByUsername(username: string): Promise<any | null> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM users WHERE username = ?;', [username]);
    return (res.rows._array as any[])[0] ?? null;
  }
  const db = await loadFallback();
  return db.users.find((u: any) => u.username === username) ?? null;
}

export async function getUserByEmail(email: string): Promise<any | null> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM users WHERE email = ?;', [email]);
    return (res.rows._array as any[])[0] ?? null;
  }
  const db = await loadFallback();
  return db.users.find((u: any) => u.email === email) ?? null;
}

export async function getAllUsers(): Promise<any[]> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM users;');
    return res.rows._array as any[];
  }
  const db = await loadFallback();
  return db.users;
}
export async function updateUser(userId: number, updates: { username?: string; email?: string; phone_number?: string | null; }) {
  await tryInitNative();
  
  if (useNative && nativeDb) {
    const sets: string[] = [];
    const params: any[] = [];
    if (updates.username !== undefined) { sets.push('username = ?'); params.push(updates.username); }
    if (updates.email !== undefined) { sets.push('email = ?'); params.push(updates.email); }
    if (sets.length === 0) return;
    params.push(userId);
    await execSqlNative(nativeDb, `UPDATE users SET ${sets.join(', ')} WHERE userId = ?;`, params);
  } else {
    const db = await loadFallback();
    const idx = db.users.findIndex((u: any) => u.userId === userId);
    if (idx === -1) return;
    db.users[idx] = { ...db.users[idx], ...updates } as any;
    await saveFallback(db);
  }
  
  // Sync to Firebase - filter out undefined values
  if (FirebaseSync.isFirebaseSyncEnabled()) {
    try {
      // Remove undefined values before passing to Firebase
      const cleanUpdates: any = {};
      if (updates.username !== undefined) cleanUpdates.username = updates.username;
      if (updates.email !== undefined) cleanUpdates.email = updates.email;
      if (updates.phone_number !== undefined) cleanUpdates.phone_number = updates.phone_number;
      
      await FirebaseSync.updateUserInFirebase(userId, cleanUpdates);
    } catch (error) {
      console.warn('Failed to update user in Firebase:', error);
    }
  }
}

export async function deleteUser(userId: number) {
  await tryInitNative();
  
  if (useNative && nativeDb) {
    await execSqlNative(nativeDb, 'DELETE FROM users WHERE userId = ?;', [userId]);
  } else {
    const db = await loadFallback();
    db.users = db.users.filter((u: any) => u.userId !== userId);
    await saveFallback(db);
  }
  
  // Sync to Firebase
  if (FirebaseSync.isFirebaseSyncEnabled()) {
    try {
      await FirebaseSync.deleteUserFromFirebase(userId);
    } catch (error) {
      console.warn('Failed to delete user from Firebase:', error);
    }
  }
}

// ============================================================================
// FRIENDS
// ============================================================================

export async function sendFriendRequest(userId: number, friendId: number): Promise<number> {
  await tryInitNative();
  let friendRowId: number;
  
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'INSERT INTO friends (userId, friendId, status) VALUES (?, ?, ?);', [userId, friendId, 'pending']);
    friendRowId = res.insertId ?? 0;
  } else {
    const db = await loadFallback();
    friendRowId = nextId(db, 'friends');
    db.friends.push({ friendRowId, userId, friendId, status: 'pending' });
    await saveFallback(db);
  }
  
  // Sync to Firebase
  if (FirebaseSync.isFirebaseSyncEnabled() && friendRowId) {
    try {
      await FirebaseSync.syncFriendRequestToFirebase({ friendRowId, userId, friendId, status: 'pending' });
    } catch (error) {
      console.warn('Failed to sync friend request to Firebase:', error);
    }
  }
  
  return friendRowId;
}

export async function respondFriendRequest(friendRowId: number, accept: boolean) {
  await tryInitNative();
  const newStatus = accept ? 'accepted' : 'rejected';
  
  if (useNative && nativeDb) {
    await execSqlNative(nativeDb, 'UPDATE friends SET status = ? WHERE friendRowId = ?;', [newStatus, friendRowId]);
  } else {
    const db = await loadFallback();
    const idx = db.friends.findIndex((f: any) => f.friendRowId === friendRowId);
    if (idx !== -1) {
      db.friends[idx].status = newStatus;
      await saveFallback(db);
    }
  }
  
  // Sync to Firebase
  if (FirebaseSync.isFirebaseSyncEnabled()) {
    try {
      await FirebaseSync.updateFriendRequestInFirebase(friendRowId, newStatus);
    } catch (error) {
      console.warn('Failed to update friend request in Firebase:', error);
    }
  }
}

export async function getFriendRequestsForUser(userId: number): Promise<any[]> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM friends WHERE friendId = ? AND status = ?;', [userId, 'pending']);
    return res.rows._array as any[];
  }
  const db = await loadFallback();
  return db.friends.filter((f: any) => f.friendId === userId && f.status === 'pending');
}

export async function getFriendsForUser(userId: number): Promise<any[]> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM friends WHERE (userId = ? OR friendId = ?) AND status = ?;', [userId, userId, 'accepted']);
    return res.rows._array as any[];
  }
  const db = await loadFallback();
  return db.friends.filter((f: any) => (f.userId === userId || f.friendId === userId) && f.status === 'accepted');
}

export async function removeFriend(friendRowId: number) {
  await tryInitNative();
  
  if (useNative && nativeDb) {
    await execSqlNative(nativeDb, 'DELETE FROM friends WHERE friendRowId = ?;', [friendRowId]);
  } else {
    const db = await loadFallback();
    db.friends = db.friends.filter((f: any) => f.friendRowId !== friendRowId);
    await saveFallback(db);
  }
  
  // Sync to Firebase
  if (FirebaseSync.isFirebaseSyncEnabled()) {
    try {
      await FirebaseSync.deleteFriendshipFromFirebase(friendRowId);
    } catch (error) {
      console.warn('Failed to delete friendship from Firebase:', error);
    }
  }
}

// ============================================================================
// RSVPS
// ============================================================================

export async function createRsvp(rsvp: { eventId: number; eventOwnerId: number; inviteRecipientId: number; status: string; }): Promise<number> {
  await tryInitNative();
  let rsvpId: number;
  const now = new Date().toISOString();
  
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'INSERT INTO rsvps (eventId, eventOwnerId, inviteRecipientId, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?);', [rsvp.eventId, rsvp.eventOwnerId, rsvp.inviteRecipientId, rsvp.status, now, now]);
    rsvpId = res.insertId ?? 0;
  } else {
    const db = await loadFallback();
    rsvpId = nextId(db, 'rsvps');
    db.rsvps.push({ rsvpId, ...rsvp, createdAt: now, updatedAt: now });
    await saveFallback(db);
  }
  
  // Sync to Firebase
  if (FirebaseSync.isFirebaseSyncEnabled() && rsvpId) {
    try {
      await FirebaseSync.syncRsvpToFirebase({ rsvpId, ...rsvp });
    } catch (error) {
      console.warn('Failed to sync RSVP to Firebase:', error);
    }
  }
  
  return rsvpId;
}

export async function getRsvpsForEvent(eventId: number): Promise<any[]> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM rsvps WHERE eventId = ?;', [eventId]);
    return res.rows._array as any[];
  }
  const db = await loadFallback();
  return db.rsvps.filter((r: any) => r.eventId === eventId);
}

export async function getRsvpsForUser(userId: number): Promise<any[]> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM rsvps WHERE inviteRecipientId = ? OR eventOwnerId = ?;', [userId, userId]);
    return res.rows._array as any[];
  }
  const db = await loadFallback();
  return db.rsvps.filter((r: any) => r.inviteRecipientId === userId || r.eventOwnerId === userId);
}

export async function updateRsvp(rsvpId: number, updates: { status?: string; }) {
  await tryInitNative();
  const now = new Date().toISOString();
  
  if (useNative && nativeDb) {
    await execSqlNative(nativeDb, 'UPDATE rsvps SET status = ?, updatedAt = ? WHERE rsvpId = ?;', [updates.status, now, rsvpId]);
  } else {
    const db = await loadFallback();
    const idx = db.rsvps.findIndex((r: any) => r.rsvpId === rsvpId);
    if (idx !== -1) {
      db.rsvps[idx] = { ...db.rsvps[idx], ...updates, updatedAt: now };
      await saveFallback(db);
    }
  }
  
  // Sync to Firebase
  if (FirebaseSync.isFirebaseSyncEnabled()) {
    try {
      await FirebaseSync.updateRsvpInFirebase(rsvpId, updates);
    } catch (error) {
      console.warn('Failed to update RSVP in Firebase:', error);
    }
  }
}

export async function deleteRsvp(rsvpId: number) {
  await tryInitNative();
  
  if (useNative && nativeDb) {
    await execSqlNative(nativeDb, 'DELETE FROM rsvps WHERE rsvpId = ?;', [rsvpId]);
  } else {
    const db = await loadFallback();
    db.rsvps = db.rsvps.filter((r: any) => r.rsvpId !== rsvpId);
    await saveFallback(db);
  }
  
  // Sync to Firebase
  if (FirebaseSync.isFirebaseSyncEnabled()) {
    try {
      await FirebaseSync.deleteRsvpFromFirebase(rsvpId);
    } catch (error) {
      console.warn('Failed to delete RSVP from Firebase:', error);
    }
  }
}

// ============================================================================
// EVENTS
// ============================================================================

export async function createEvent(event: { userId: number; eventTitle?: string | null; description?: string | null; startTime: string; endTime?: string | null; date?: string | null; isEvent?: number; recurring?: number; }): Promise<number> {
  await tryInitNative();
  let eventId: number;
  const title = event.eventTitle ?? 'Untitled Event';
  
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'INSERT INTO events (userId, eventTitle, description, startTime, endTime, isEvent, recurring, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?);', [event.userId, title, event.description ?? null, event.startTime, event.endTime ?? null, event.isEvent ?? 1, event.recurring ?? 0, event.date ?? null]);
    eventId = res.insertId ?? 0;
  } else {
    const db = await loadFallback();
    eventId = nextId(db, 'events');
    db.events.push({ eventId, userId: event.userId, eventTitle: title, description: event.description ?? null, startTime: event.startTime, endTime: event.endTime ?? null, date: event.date ?? null, isEvent: event.isEvent ?? 1, recurring: event.recurring ?? 0 });
    await saveFallback(db);
  }
  
  // Sync to Firebase
  if (FirebaseSync.isFirebaseSyncEnabled() && eventId) {
    try {
      await FirebaseSync.syncEventToFirebase({ eventId, ...event, eventTitle: title });
    } catch (error) {
      console.warn('Failed to sync event to Firebase:', error);
    }
  }
  
  return eventId;
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
  } else {
    const db = await loadFallback();
    db.events = db.events.filter(e => e.eventId !== eventId);
    await saveFallback(db);
  }
  
  // Sync to Firebase
  if (FirebaseSync.isFirebaseSyncEnabled()) {
    try {
      await FirebaseSync.deleteEventFromFirebase(eventId);
    } catch (error) {
      console.warn('Failed to delete event from Firebase:', error);
    }
  }
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
  } else {
    const db = await loadFallback();
    const idx = db.events.findIndex(e => e.eventId === eventId);
    if (idx === -1) return;
    db.events[idx] = { ...db.events[idx], ...fields } as any;
    await saveFallback(db);
  }
  
  // Sync to Firebase
  if (FirebaseSync.isFirebaseSyncEnabled()) {
    try {
      await FirebaseSync.updateEventInFirebase(eventId, fields);
    } catch (error) {
      console.warn('Failed to update event in Firebase:', error);
    }
  }
}

// Free time (stored as events with isEvent = 0)
export async function addFreeTime(slot: { userId: number; startTime: string; endTime?: string; }): Promise<number> {
  return createEvent({ ...slot, isEvent: 0 });
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

// ============================================================================
// NOTIFICATIONS
// ============================================================================

export async function addNotification(note: { userId: number; notifMsg: string; notifType?: string; timestamp?: string; }): Promise<number> {
  await tryInitNative();
  let notificationId: number;
  
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'INSERT INTO notifications (userId, notifMsg, notifType, createdAt) VALUES (?, ?, ?, ?);', [note.userId, note.notifMsg, note.notifType ?? null, note.timestamp ?? new Date().toISOString()]);
    notificationId = res.insertId ?? 0;
  } else {
    const db = await loadFallback();
    notificationId = nextId(db, 'notifications');
    db.notifications.push({ notificationId, userId: note.userId, notifMsg: note.notifMsg, notifType: note.notifType ?? null, createdAt: note.timestamp ?? new Date().toISOString() });
    await saveFallback(db);
  }
  
  // Sync to Firebase
  if (FirebaseSync.isFirebaseSyncEnabled() && notificationId) {
    try {
      await FirebaseSync.syncNotificationToFirebase({ 
        notificationId, 
        userId: note.userId, 
        notifMsg: note.notifMsg, 
        notifType: note.notifType,
        createdAt: note.timestamp
      });
    } catch (error) {
      console.warn('Failed to sync notification to Firebase:', error);
    }
  }
  
  return notificationId;
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
  } else {
    const db = await loadFallback();
    db.notifications = db.notifications.filter(n => n.userId !== userId);
    await saveFallback(db);
  }
  
  // Sync to Firebase
  if (FirebaseSync.isFirebaseSyncEnabled()) {
    try {
      await FirebaseSync.clearNotificationsInFirebase(userId);
    } catch (error) {
      console.warn('Failed to clear notifications in Firebase:', error);
    }
  }
}

// ============================================================================
// PREFERENCES
// ============================================================================

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
  } else {
    const db = await loadFallback();
    const idx = db.user_prefs.findIndex((p: any) => p.userId === userId);
    if (idx !== -1) {
      db.user_prefs[idx] = { ...db.user_prefs[idx], ...prefs, updatedAt: new Date().toISOString() };
    } else {
      db.user_prefs.push({ preferenceId: nextId(db, 'user_prefs'), userId, theme: prefs.theme ?? 0, notificationEnabled: prefs.notificationEnabled ?? 1, colorScheme: prefs.colorScheme ?? 0, updatedAt: new Date().toISOString() });
    }
    await saveFallback(db);
  }
  
  // Sync to Firebase
  if (FirebaseSync.isFirebaseSyncEnabled()) {
    try {
      await FirebaseSync.syncUserPreferencesToFirebase(userId, prefs);
    } catch (error) {
      console.warn('Failed to sync preferences to Firebase:', error);
    }
  }
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