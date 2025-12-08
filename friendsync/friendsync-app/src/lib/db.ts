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
    // Ensure legacy event rows may have userFirebaseUid
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
    userId INTEGER,
    userFirebaseUid TEXT
  );`);

  await execSqlNative(nativeDb, `CREATE TABLE IF NOT EXISTS friends (
    friendRowId INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    friendId INTEGER,
    userFirebaseUid TEXT,
    friendFirebaseUid TEXT,
    status TEXT
  );`);

  await execSqlNative(nativeDb, `CREATE TABLE IF NOT EXISTS rsvps (
    rsvpId INTEGER PRIMARY KEY AUTOINCREMENT,
    createdAt TEXT,
    eventId INTEGER,
    eventOwnerId INTEGER,
    eventOwnerFirebaseUid TEXT,
    inviteRecipientId INTEGER,
    inviteRecipientFirebaseUid TEXT,
    status TEXT,
    updatedAt TEXT
  );`);

  await execSqlNative(nativeDb, `CREATE TABLE IF NOT EXISTS user_prefs (
    preferenceId INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    userFirebaseUid TEXT,
    colorScheme INTEGER,
    notificationEnabled INTEGER,
    theme INTEGER,
    updatedAt TEXT
  );`);

  await execSqlNative(nativeDb, `CREATE TABLE IF NOT EXISTS users (
    userId INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    username TEXT,
    firebaseUid TEXT
  );`);

  await execSqlNative(nativeDb, `CREATE TABLE IF NOT EXISTS notifications (
    notificationId INTEGER PRIMARY KEY AUTOINCREMENT,
    notifMsg TEXT,
    userId INTEGER,
    userFirebaseUid TEXT,
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
  // Run a non-destructive dedupe dry-run at init for consistent detection
  try {
    const report = await runDuplicateCleanup({ dryRun: true });
    if (report && report.groups && Array.isArray(report.groups) && report.groups.length > 0) {
      console.warn('db.init_db: duplicate user groups detected (dry-run):', report.groups);
    }
  } catch (e) {
    // ignore dedupe errors at startup
  }
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
    const res: any = await execSqlNative(nativeDb, 'INSERT INTO users (email, username, firebaseUid) VALUES (?, ?, ?);', [user.email, user.username, user.firebaseUid ?? null]);
    userId = res.insertId ?? 0;
  } else {
    const db = await loadFallback();
    userId = nextId(db, 'users');
    db.users.push({ userId, username: user.username, email: user.email, firebaseUid: user.firebaseUid ?? null });
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

export async function getUserByFirebaseUid(firebaseUid: string): Promise<any | null> {
  await tryInitNative();
  if (!firebaseUid) return null;
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM users WHERE firebaseUid = ?;', [firebaseUid]);
    return (res.rows._array as any[])[0] ?? null;
  }
  const db = await loadFallback();
  return db.users.find((u: any) => u.firebaseUid === firebaseUid) ?? null;
}

export async function resolveLocalUserId(): Promise<number | null> {
  try {
    const storedId = await storage.getItem<any>('userId');
    const storedUid = await storage.getItem<any>('firebaseUid');

    // Prefer mapping by firebaseUid if available
    if (storedUid) {
      const byUid = await getUserByFirebaseUid(String(storedUid));
      if (byUid && byUid.userId) return Number(byUid.userId);
    }

    if (storedId != null) {
      const asNum = Number(storedId);
      if (!Number.isNaN(asNum)) {
        const u = await getUserById(asNum);
        if (u && u.userId) return Number(u.userId);
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
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

export async function updateUser(userId: number, updates: { username?: string; email?: string; phone_number?: string | null; firebaseUid?: string | null }) {
  await tryInitNative();
  
  if (useNative && nativeDb) {
    const sets: string[] = [];
    const params: any[] = [];
    if (updates.username !== undefined) { sets.push('username = ?'); params.push(updates.username); }
    if (updates.email !== undefined) { sets.push('email = ?'); params.push(updates.email); }
    if (updates.firebaseUid !== undefined) { sets.push('firebaseUid = ?'); params.push(updates.firebaseUid); }
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
  
  // Sync to Firebase
  if (FirebaseSync.isFirebaseSyncEnabled()) {
    try {
      // pass firebaseUid when available so Firebase update can target the correct doc
      let __userFb: string | null = null;
      if (updates.firebaseUid !== undefined) __userFb = updates.firebaseUid ?? null;
      else {
        try { const uu = await getUserById(userId); __userFb = uu?.firebaseUid ?? null; } catch (_) { __userFb = null; }
      }
      await FirebaseSync.updateUserInFirebase(userId, updates, __userFb ?? undefined);
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
      // pass firebaseUid when available for direct delete by UID
      let __delFb: string | null = null;
      try { const uu = await getUserById(userId); __delFb = uu?.firebaseUid ?? null; } catch (_) { __delFb = null; }
      await FirebaseSync.deleteUserFromFirebase(userId, __delFb ?? undefined);
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
    // fetch firebase UIDs for both sides when available
    let uFirebase: string | null = null;
    let fFirebase: string | null = null;
    try { const ru = await execSqlNative(nativeDb, 'SELECT firebaseUid FROM users WHERE userId = ?;', [userId]); const rowu = (ru.rows._array as any[])[0] ?? null; if (rowu && rowu.firebaseUid) uFirebase = rowu.firebaseUid; } catch (_) { uFirebase = null; }
    try { const rf = await execSqlNative(nativeDb, 'SELECT firebaseUid FROM users WHERE userId = ?;', [friendId]); const rowf = (rf.rows._array as any[])[0] ?? null; if (rowf && rowf.firebaseUid) fFirebase = rowf.firebaseUid; } catch (_) { fFirebase = null; }
    const res: any = await execSqlNative(nativeDb, 'INSERT INTO friends (userId, friendId, userFirebaseUid, friendFirebaseUid, status) VALUES (?, ?, ?, ?, ?);', [userId, friendId, uFirebase ?? null, fFirebase ?? null, 'pending']);
    friendRowId = res.insertId ?? 0;
  } else {
    const db = await loadFallback();
    friendRowId = nextId(db, 'friends');
    // attach firebase UIDs for both sides when possible to make lookups robust
    let userFirebase: string | null = null;
    let friendFirebase: string | null = null;
    try { const u = db.users.find((x: any) => Number(x.userId) === Number(userId)); if (u && u.firebaseUid) userFirebase = u.firebaseUid; } catch (_) { userFirebase = null; }
    try { const f = db.users.find((x: any) => Number(x.userId) === Number(friendId)); if (f && f.firebaseUid) friendFirebase = f.firebaseUid; } catch (_) { friendFirebase = null; }
    db.friends.push({ friendRowId, userId, friendId, userFirebaseUid: userFirebase ?? null, friendFirebaseUid: friendFirebase ?? null, status: 'pending' });
    await saveFallback(db);
  }
  
  // Sync to Firebase
  if (FirebaseSync.isFirebaseSyncEnabled() && friendRowId) {
    try {
      // Resolve firebaseUid for both sides to include in the payload
      let __uFb: string | null = null;
      let __fFb: string | null = null;
      try { const uu = await getUserById(userId); __uFb = uu?.firebaseUid ?? null; } catch (_) { __uFb = null; }
      try { const ff = await getUserById(friendId); __fFb = ff?.firebaseUid ?? null; } catch (_) { __fFb = null; }
      await FirebaseSync.syncFriendRequestToFirebase({ friendRowId, userId, friendId, status: 'pending', userFirebaseUid: __uFb, friendFirebaseUid: __fFb });
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

  // If the request was accepted, ensure the accepter gets RSVPs for existing events
  if (accept) {
    try {
      // Load the friend row to determine requester and recipient
      let row: any = null;
      if (useNative && nativeDb) {
        try {
          const res: any = await execSqlNative(nativeDb, 'SELECT * FROM friends WHERE friendRowId = ?;', [friendRowId]);
          row = (res.rows._array as any[])[0] ?? null;
        } catch (e) { row = null; }
      } else {
        try {
          const fdb = await loadFallback();
          row = fdb.friends.find((f: any) => f.friendRowId === friendRowId) ?? null;
        } catch (e) { row = null; }
      }

      if (row) {
        const requester = Number(row.userId);
        const recipient = Number(row.friendId);
        if (requester && recipient) {
          // For each event owned by the requester, create an RSVP for the recipient if missing
          const events = await getEventsForUser(requester);
          for (const ev of events) {
            try {
              const existing = (await getRsvpsForEvent(Number(ev.eventId))) || [];
              const has = existing.find((r: any) => Number(r.inviteRecipientId) === recipient);
              if (!has) {
                try { await createRsvp({ eventId: Number(ev.eventId), eventOwnerId: requester, inviteRecipientId: recipient, status: 'pending' }); } catch (_) { /* ignore per-item */ }
              }
            } catch (_) { /* ignore per-event */ }
          }
        }
      }
    } catch (e) {
      // ignore background RSVP creation errors
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
    // resolve firebase UIDs for owner and invitee when possible
    let ownerFb: string | null = null;
    let inviteeFb: string | null = null;
    try { const ru = await execSqlNative(nativeDb, 'SELECT firebaseUid FROM users WHERE userId = ?;', [rsvp.eventOwnerId]); const rowu = (ru.rows._array as any[])[0] ?? null; if (rowu && rowu.firebaseUid) ownerFb = rowu.firebaseUid; } catch (_) { ownerFb = null; }
    try { const rv = await execSqlNative(nativeDb, 'SELECT firebaseUid FROM users WHERE userId = ?;', [rsvp.inviteRecipientId]); const rowv = (rv.rows._array as any[])[0] ?? null; if (rowv && rowv.firebaseUid) inviteeFb = rowv.firebaseUid; } catch (_) { inviteeFb = null; }
    const res: any = await execSqlNative(nativeDb, 'INSERT INTO rsvps (eventId, eventOwnerId, eventOwnerFirebaseUid, inviteRecipientId, inviteRecipientFirebaseUid, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?);', [rsvp.eventId, rsvp.eventOwnerId, ownerFb ?? null, rsvp.inviteRecipientId, inviteeFb ?? null, rsvp.status, now, now]);
    rsvpId = res.insertId ?? 0;
  } else {
    const db = await loadFallback();
    rsvpId = nextId(db, 'rsvps');
    // include firebase UIDs for owner and invitee when available
    let ownerFirebase: string | null = null;
    let inviteeFirebase: string | null = null;
    try { const u = db.users.find((x: any) => Number(x.userId) === Number(rsvp.eventOwnerId)); if (u && u.firebaseUid) ownerFirebase = u.firebaseUid; } catch (_) { ownerFirebase = null; }
    try { const v = db.users.find((x: any) => Number(x.userId) === Number(rsvp.inviteRecipientId)); if (v && v.firebaseUid) inviteeFirebase = v.firebaseUid; } catch (_) { inviteeFirebase = null; }
    db.rsvps.push({ rsvpId, ...rsvp, eventOwnerFirebaseUid: ownerFirebase ?? null, inviteRecipientFirebaseUid: inviteeFirebase ?? null, createdAt: now, updatedAt: now });
    await saveFallback(db);
  }
  
  // Sync to Firebase
  if (FirebaseSync.isFirebaseSyncEnabled() && rsvpId) {
    try {
      // attach firebaseUid variants for owner and invitee
      let __ownerFb: string | null = null; let __inviteeFb: string | null = null;
      try { const o = await getUserById(rsvp.eventOwnerId); __ownerFb = o?.firebaseUid ?? null; } catch (_) { __ownerFb = null; }
      try { const v = await getUserById(rsvp.inviteRecipientId); __inviteeFb = v?.firebaseUid ?? null; } catch (_) { __inviteeFb = null; }
      await FirebaseSync.syncRsvpToFirebase({ rsvpId, ...rsvp, eventOwnerFirebaseUid: __ownerFb, inviteRecipientFirebaseUid: __inviteeFb });
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
    // fetch owner's firebaseUid when available so we can persist it alongside the event
    let ownerFirebaseUidNative: string | null = null;
    try {
      const ru = await execSqlNative(nativeDb, 'SELECT firebaseUid FROM users WHERE userId = ?;', [event.userId]);
      const row = (ru.rows._array as any[])[0] ?? null;
      if (row && row.firebaseUid) ownerFirebaseUidNative = row.firebaseUid;
    } catch (e) { ownerFirebaseUidNative = null; }
    const res: any = await execSqlNative(nativeDb, 'INSERT INTO events (userId, userFirebaseUid, eventTitle, description, startTime, endTime, isEvent, recurring, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);', [event.userId, ownerFirebaseUidNative ?? null, title, event.description ?? null, event.startTime, event.endTime ?? null, event.isEvent ?? 1, event.recurring ?? 0, event.date ?? null]);
    eventId = res.insertId ?? 0;
  } else {
    const db = await loadFallback();
    eventId = nextId(db, 'events');
    // attach owner's firebaseUid when possible for easier resolution later
    let ownerFirebaseUid: string | null = null;
    try { const owner = db.users.find((u: any) => Number(u.userId) === Number(event.userId)); if (owner && owner.firebaseUid) ownerFirebaseUid = owner.firebaseUid; } catch (_) { ownerFirebaseUid = null; }
    db.events.push({ eventId, userId: event.userId, userFirebaseUid: ownerFirebaseUid ?? null, eventTitle: title, description: event.description ?? null, startTime: event.startTime, endTime: event.endTime ?? null, date: event.date ?? null, isEvent: event.isEvent ?? 1, recurring: event.recurring ?? 0 });
    await saveFallback(db);
  }
  
  // Sync to Firebase
  if (FirebaseSync.isFirebaseSyncEnabled() && eventId) {
    try {
      // include owner firebase uid when available
      let __ownerFb: string | null = null;
      try { const o = await getUserById(event.userId); __ownerFb = o?.firebaseUid ?? null; } catch (_) { __ownerFb = null; }
      await FirebaseSync.syncEventToFirebase({ eventId, ...event, eventTitle: title, userFirebaseUid: __ownerFb });
    } catch (error) {
      console.warn('Failed to sync event to Firebase:', error);
    }
  }

  // After creating an event, invite all accepted friends of the owner by creating RSVPs.
  // This ensures friends are invited to new events automatically. We avoid creating
  // duplicate RSVPs by checking for existing RSVP rows for the same event/invitee.
  (async () => {
    try {
      const ownerId = Number(event.userId);
      if (!ownerId) return;
      const friends = await getFriendsForUser(ownerId); // returns accepted friends
      const inviteeIds = new Set<number>();
      for (const f of friends) {
        const other = Number(f.userId) === ownerId ? Number(f.friendId) : Number(f.userId);
        if (!other || other === ownerId) continue;
        inviteeIds.add(other);
      }
      if (inviteeIds.size === 0) return;
      const existingRsvps = await getRsvpsForEvent(Number(eventId));
      for (const invitee of Array.from(inviteeIds)) {
        const already = (existingRsvps || []).find((r: any) => Number(r.inviteRecipientId) === Number(invitee));
        if (!already) {
          try {
            await createRsvp({ eventId: Number(eventId), eventOwnerId: ownerId, inviteRecipientId: invitee, status: 'pending' });
          } catch (e) { /* ignore per-invite errors */ }
        }
      }
    } catch (e) {
      // ignore background invite errors
    }
  })();
  
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
    // Resolve the user's firebaseUid when available so fallback notifications include it
    const __notifUser = await getUserById(note.userId);
    const __notifUserFirebase = __notifUser?.firebaseUid ?? null;
    db.notifications.push({ notificationId, userId: note.userId, userFirebaseUid: __notifUserFirebase, notifMsg: note.notifMsg, notifType: note.notifType ?? null, createdAt: note.timestamp ?? new Date().toISOString() });
    await saveFallback(db);
  }
  
  // Sync to Firebase
  if (FirebaseSync.isFirebaseSyncEnabled() && notificationId) {
    try {
      // include firebaseUid when available to help backend mapping
      const __notifUser = await getUserById(note.userId);
      const __notifUserFirebase = __notifUser?.firebaseUid ?? null;
      await FirebaseSync.syncNotificationToFirebase({ 
        notificationId, 
        userId: note.userId, 
        userFirebaseUid: __notifUserFirebase,
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
      // include user's firebaseUid on preference rows when available
      const __prefsUser = await getUserById(userId);
      const __prefsUserFirebase = __prefsUser?.firebaseUid ?? null;
      db.user_prefs.push({ preferenceId: nextId(db, 'user_prefs'), userId, userFirebaseUid: __prefsUserFirebase, theme: prefs.theme ?? 0, notificationEnabled: prefs.notificationEnabled ?? 1, colorScheme: prefs.colorScheme ?? 0, updatedAt: new Date().toISOString() });
    }
    await saveFallback(db);
  }
  
  // Sync to Firebase
  if (FirebaseSync.isFirebaseSyncEnabled()) {
    try {
      // include user's firebaseUid where possible
      let __prefsFb: string | null = null;
      try { const uu = await getUserById(userId); __prefsFb = uu?.firebaseUid ?? null; } catch (_) { __prefsFb = null; }
      await FirebaseSync.syncUserPreferencesToFirebase(userId, prefs, __prefsFb);
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

// ============================================================================
// DEDUPE HELPERS
// ============================================================================

export async function findUserDuplicates(): Promise<Array<{ keepId: number; duplicateIds: number[]; by: string }>> {
  const users = await getAllUsers();
  const seen = new Set<number>();
  const groups: Array<{ keepId: number; duplicateIds: number[]; by: string }> = [];

  const scoreUser = (u: any) => {
    // Higher score => more complete / preferred as keeper
    let s = 0;
    if (u && u.firebaseUid) s += 100;
    if (u && u.username && String(u.username).trim().length > 0) s += 10;
    if (u && u.email && String(u.email).trim().length > 0) s += 1;
    return s;
  };

  // 1) Group by firebaseUid first (strongest identity)
  const byUid: { [uid: string]: any[] } = {};
  users.forEach((u: any) => { if (u && u.firebaseUid) { (byUid[String(u.firebaseUid)] = byUid[String(u.firebaseUid)] || []).push(u); } });
  Object.keys(byUid).forEach((uid) => {
    const arr = byUid[uid];
    if (arr.length > 1) {
      // select keeper by highest score, fallback to lowest userId
      arr.sort((a: any, b: any) => {
        const d = scoreUser(b) - scoreUser(a);
        if (d !== 0) return d;
        return Number(a.userId) - Number(b.userId);
      });
      const keeper = arr[0];
      const dupIds = arr.slice(1).map(x => Number(x.userId));
      dupIds.forEach(i => seen.add(i));
      groups.push({ keepId: Number(keeper.userId), duplicateIds: dupIds, by: 'firebaseUid' });
    }
  });

  // 2) Group by normalized email for remaining users
  const byEmail: { [email: string]: any[] } = {};

  const extractEmail = (u: any) => {
    if (!u) return '';
    // handle alternate property names that might hold email
    const candidates = [u.email, u.userEmail, u.emailAddress, u.email_address, u.mail];
    for (const c of candidates) {
      if (c && String(c).trim().length > 0) return String(c).trim();
    }
    return '';
  };

  const normalizeEmail = (raw: string) => {
    if (!raw) return '';
    const e = String(raw).toLowerCase().trim();
    const parts = e.split('@');
    if (parts.length !== 2) return e;
    let [local, domain] = parts;
    // Remove plus tags and dots for Gmail/Googlemail addresses
    if (domain === 'gmail.com' || domain === 'googlemail.com') {
      local = local.split('+')[0].replace(/\./g, '');
      domain = 'gmail.com';
    } else {
      // For other providers, still strip plus tags (common pattern)
      local = local.split('+')[0];
    }
    return `${local}@${domain}`;
  };

  users.forEach((u: any) => {
    const raw = extractEmail(u);
    const e = normalizeEmail(raw);
    if (e) {
      (byEmail[e] = byEmail[e] || []).push(u);
    }
  });
  Object.keys(byEmail).forEach((email) => {
    const arr = byEmail[email];
    const unique = arr.filter(x => !seen.has(Number(x.userId)));
    if (unique.length > 1) {
      // choose keeper by completeness score
      unique.sort((a: any, b: any) => {
        const d = scoreUser(b) - scoreUser(a);
        if (d !== 0) return d;
        return Number(a.userId) - Number(b.userId);
      });
      const keeper = unique[0];
      const dupIds = unique.slice(1).map(x => Number(x.userId));
      dupIds.forEach(i => seen.add(i));
      groups.push({ keepId: Number(keeper.userId), duplicateIds: dupIds, by: 'email' });
    }
  });

  // 3) Group by username (fallback) for users missing email/firebaseUid
  const byName: { [name: string]: any[] } = {};
  users.forEach((u: any) => {
    const rawEmail = extractEmail(u);
    const hasUidOrEmail = !!(u && (u.firebaseUid || (rawEmail && String(rawEmail).trim().length > 0)));
    if (hasUidOrEmail) return; // we already handled these
    const n = (u && (u.username || u.name)) ? String(u.username || u.name).toLowerCase().trim() : '';
    if (n) (byName[n] = byName[n] || []).push(u);
  });
  Object.keys(byName).forEach((name) => {
    const arr = byName[name];
    if (arr.length > 1) {
      arr.sort((a: any, b: any) => {
        const d = scoreUser(b) - scoreUser(a);
        if (d !== 0) return d;
        return Number(a.userId) - Number(b.userId);
      });
      const keeper = arr[0];
      const dupIds = arr.slice(1).map(x => Number(x.userId));
      dupIds.forEach(i => seen.add(i));
      groups.push({ keepId: Number(keeper.userId), duplicateIds: dupIds, by: 'username' });
    }
  });

  return groups;
}

export async function mergeUsers(keepId: number, removeId: number): Promise<void> {
  if (!keepId || !removeId || keepId === removeId) return;

  // Prefer keeper selection policy: if the `removeId` row has a firebaseUid
  // but the `keepId` row does not, swap them so we keep the row with firebaseUid.
  try {
    const a = await getUserById(keepId);
    const b = await getUserById(removeId);
    const aHas = !!(a && a.firebaseUid);
    const bHas = !!(b && b.firebaseUid);
    if (!aHas && bHas) {
      // swap so that we keep the row that has firebaseUid
      const tmp = keepId; keepId = removeId; removeId = tmp;
    }
  } catch (e) {
    // ignore any lookup errors and continue with provided ids
  }

  // NOTE: Do NOT move or delete events during user merges.
  // Keeping events intact avoids side-effects where duplicate cleanup inadvertently
  // changes event ownership or removes user-created events. RSVPs referencing
  // events will be adjusted below to point to the keeper user where appropriate,
  // but `events` rows themselves are left untouched.
  const eventIdMap: { [oldId: number]: number } = {};

  // 2) Move RSVPs: recreate with same eventId (no event recreation) but remapped userIds where needed,
  // then delete the old RSVP entries. This updates ownership/invitee references without touching events.
  const rsvps = await getRsvpsForUser(removeId);
  for (const r of rsvps) {
    const newOwner = (Number(r.eventOwnerId) === Number(removeId)) ? keepId : r.eventOwnerId;
    const newInvitee = (Number(r.inviteRecipientId) === Number(removeId)) ? keepId : r.inviteRecipientId;
    try {
      await createRsvp({ eventId: Number(r.eventId), eventOwnerId: Number(newOwner), inviteRecipientId: Number(newInvitee), status: r.status });
    } catch (e) {
      // ignore creation errors but continue attempting to delete the old RSVP
    }
    try { await deleteRsvp(Number(r.rsvpId)); } catch (e) { /* ignore */ }
  }

  // 3) Move friends: recreate friendships for keepId and remove old
  const friends = await getFriendsForUser(removeId);
  const keepFriends = await getFriendsForUser(keepId);
  const keepFriendSet = new Set<number>(keepFriends.map((f: any) => (f.userId === keepId ? f.friendId : f.userId)));
  for (const f of friends) {
    const other = (Number(f.userId) === Number(removeId)) ? f.friendId : f.userId;
    if (Number(other) === Number(keepId)) {
      // self-reference after merge — just remove
      try { await removeFriend(f.friendRowId); } catch (e) { /* ignore */ }
      continue;
    }
    if (keepFriendSet.has(Number(other))) {
      // already friends with keeper, remove old relation
      try { await removeFriend(f.friendRowId); } catch (e) { /* ignore */ }
      continue;
    }
    // create friend relation under keepId
    try {
      const newRow = await sendFriendRequest(keepId, Number(other));
      if (f.status === 'accepted') {
        const requests = await getFriendRequestsForUser(keepId);
        const req = requests.find((r2: any) => Number(r2.friendId) === Number(other));
        if (req) await respondFriendRequest(req.friendRowId, true);
      }
    } catch (e) {
      // ignore create errors
    }
    try { await removeFriend(f.friendRowId); } catch (e) { /* ignore */ }
  }

  // 4) Move notifications
  const notes = await getNotificationsForUser(removeId);
  for (const n of notes) {
    try { await addNotification({ userId: keepId, notifMsg: n.notifMsg, notifType: n.notifType, timestamp: n.createdAt }); } catch (e) { /* ignore */ }
  }
  try { await clearNotificationsForUser(removeId); } catch (e) { /* ignore */ }

  // 5) Merge preferences (keep existing keeper prefs, fill missing from remove)
  try {
    const fromPrefs = await getUserPreferences(removeId);
    if (fromPrefs) {
      const toPrefs = await getUserPreferences(keepId) || {};
      const merged = {
        theme: toPrefs.theme ?? fromPrefs.theme,
        notificationEnabled: toPrefs.notificationEnabled ?? fromPrefs.notificationEnabled,
        colorScheme: toPrefs.colorScheme ?? fromPrefs.colorScheme,
      };
      await setUserPreferences(keepId, merged as any);
    }
  } catch (e) { /* ignore */ }

  // 6) Finally delete the removed user row
  try { await deleteUser(removeId); } catch (e) { /* ignore */ }
}

export async function runDuplicateCleanup(options?: { dryRun?: boolean; autoMerge?: boolean }): Promise<any> {
  const dryRun = options?.dryRun ?? true;
  const autoMerge = options?.autoMerge ?? false;
  const groups = await findUserDuplicates();
  const report: any[] = [];
  for (const g of groups) {
    report.push({ keepId: g.keepId, duplicateIds: g.duplicateIds, by: g.by });
  }

  if (dryRun) return { dryRun: true, groups: report };

  const results: any[] = [];
  for (const g of groups) {
    for (const dup of g.duplicateIds) {
      if (autoMerge) {
        try {
          await mergeUsers(g.keepId, dup);
          results.push({ keep: g.keepId, removed: dup, status: 'merged' });
        } catch (e) {
          results.push({ keep: g.keepId, removed: dup, status: 'failed', error: String(e) });
        }
      } else {
        // destructive delete without merge is not implemented by default
        results.push({ keep: g.keepId, removed: dup, status: 'skipped', reason: 'autoMerge disabled' });
      }
    }
  }
  return { dryRun: false, results };
}

// One-time migration: backfill firebaseUid fields across fallback/native tables
export async function backfillFirebaseUids(): Promise<any> {
  await tryInitNative();
  const counts: any = { events: 0, rsvps: 0, friends: 0, user_prefs: 0, notifications: 0 };

  if (useNative && nativeDb) {
    try {
      const resE: any = await execSqlNative(nativeDb, `UPDATE events SET userFirebaseUid = (SELECT firebaseUid FROM users WHERE users.userId = events.userId) WHERE userFirebaseUid IS NULL OR userFirebaseUid = '' ;`);
      counts.events = resE.rowsAffected ?? 0;
    } catch (e) { /* ignore */ }
    try {
      const resF1: any = await execSqlNative(nativeDb, `UPDATE friends SET userFirebaseUid = (SELECT firebaseUid FROM users WHERE users.userId = friends.userId) WHERE userFirebaseUid IS NULL OR userFirebaseUid = '';`);
      const resF2: any = await execSqlNative(nativeDb, `UPDATE friends SET friendFirebaseUid = (SELECT firebaseUid FROM users WHERE users.userId = friends.friendId) WHERE friendFirebaseUid IS NULL OR friendFirebaseUid = '';`);
      counts.friends = (resF1.rowsAffected ?? 0) + (resF2.rowsAffected ?? 0);
    } catch (e) { /* ignore */ }
    try {
      const resR1: any = await execSqlNative(nativeDb, `UPDATE rsvps SET eventOwnerFirebaseUid = (SELECT firebaseUid FROM users WHERE users.userId = rsvps.eventOwnerId) WHERE eventOwnerFirebaseUid IS NULL OR eventOwnerFirebaseUid = '';`);
      const resR2: any = await execSqlNative(nativeDb, `UPDATE rsvps SET inviteRecipientFirebaseUid = (SELECT firebaseUid FROM users WHERE users.userId = rsvps.inviteRecipientId) WHERE inviteRecipientFirebaseUid IS NULL OR inviteRecipientFirebaseUid = '';`);
      counts.rsvps = (resR1.rowsAffected ?? 0) + (resR2.rowsAffected ?? 0);
    } catch (e) { /* ignore */ }
    try {
      const resP: any = await execSqlNative(nativeDb, `UPDATE user_prefs SET userFirebaseUid = (SELECT firebaseUid FROM users WHERE users.userId = user_prefs.userId) WHERE userFirebaseUid IS NULL OR userFirebaseUid = '';`);
      counts.user_prefs = resP.rowsAffected ?? 0;
    } catch (e) { /* ignore */ }
    try {
      const resN: any = await execSqlNative(nativeDb, `UPDATE notifications SET userFirebaseUid = (SELECT firebaseUid FROM users WHERE users.userId = notifications.userId) WHERE userFirebaseUid IS NULL OR userFirebaseUid = '';`);
      counts.notifications = resN.rowsAffected ?? 0;
    } catch (e) { /* ignore */ }

    return counts;
  }

  // Fallback JS-backed DB
  const db = await loadFallback();
  const uidById = new Map<number, string | null>();
  for (const u of db.users) {
    if (u && typeof u.userId !== 'undefined') uidById.set(Number(u.userId), u.firebaseUid ?? null);
  }

  for (const e of db.events) {
    if ((e.userFirebaseUid === undefined || e.userFirebaseUid === null || e.userFirebaseUid === '') && e.userId) {
      const v = uidById.get(Number(e.userId)) ?? null;
      if (v) { e.userFirebaseUid = v; counts.events++; }
    }
  }

  for (const r of db.rsvps) {
    if ((r.eventOwnerFirebaseUid === undefined || r.eventOwnerFirebaseUid === null || r.eventOwnerFirebaseUid === '') && r.eventOwnerId) {
      const v = uidById.get(Number(r.eventOwnerId)) ?? null;
      if (v) { r.eventOwnerFirebaseUid = v; counts.rsvps++; }
    }
    if ((r.inviteRecipientFirebaseUid === undefined || r.inviteRecipientFirebaseUid === null || r.inviteRecipientFirebaseUid === '') && r.inviteRecipientId) {
      const v2 = uidById.get(Number(r.inviteRecipientId)) ?? null;
      if (v2) { r.inviteRecipientFirebaseUid = v2; counts.rsvps++; }
    }
  }

  for (const f of db.friends) {
    if ((f.userFirebaseUid === undefined || f.userFirebaseUid === null || f.userFirebaseUid === '') && f.userId) {
      const v = uidById.get(Number(f.userId)) ?? null;
      if (v) { f.userFirebaseUid = v; counts.friends++; }
    }
    if ((f.friendFirebaseUid === undefined || f.friendFirebaseUid === null || f.friendFirebaseUid === '') && f.friendId) {
      const v2 = uidById.get(Number(f.friendId)) ?? null;
      if (v2) { f.friendFirebaseUid = v2; counts.friends++; }
    }
  }

  for (const p of db.user_prefs) {
    if ((p.userFirebaseUid === undefined || p.userFirebaseUid === null || p.userFirebaseUid === '') && p.userId) {
      const v = uidById.get(Number(p.userId)) ?? null;
      if (v) { p.userFirebaseUid = v; counts.user_prefs++; }
    }
  }

  for (const n of db.notifications) {
    if ((n.userFirebaseUid === undefined || n.userFirebaseUid === null || n.userFirebaseUid === '') && n.userId) {
      const v = uidById.get(Number(n.userId)) ?? null;
      if (v) { n.userFirebaseUid = v; counts.notifications++; }
    }
  }

  await saveFallback(db);
  return counts;
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
  getUserByFirebaseUid,
  resolveLocalUserId,
  backfillFirebaseUids,
  getAllUsers,
  // Dedupe helpers
  findUserDuplicates,
  mergeUsers,
  runDuplicateCleanup,

  getStatus,
};