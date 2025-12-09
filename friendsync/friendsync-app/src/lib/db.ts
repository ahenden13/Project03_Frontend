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
import { emit } from './eventBus';

// ⚠️ TEMPORARILY DISABLE FIREBASE SYNC TO STOP DUPLICATES
// FirebaseSync.setFirebaseSyncEnabled(false);  // ← ADD THIS LINE!

const API_BASE_URL = 'https://project03-friendsync-backend-8c893d18fe37.herokuapp.com';

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
let fallbackSaveLock: Promise<void> | null = null;

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
    users: Array.isArray(val.users) ? val.users.map((u: any) => ({ userId: Number(u.userId ?? 0), email: u.email ?? '', username: u.username ?? '', phone_number: u.phone_number ?? u.phoneNumber ?? '', firebase_uid: u.firebase_uid ?? u.firebaseUid ?? '', remote_user_id: (u.remote_user_id ?? u.remoteId ?? u.serverId ?? u.userId ?? '') })) : [],
    friends: Array.isArray(val.friends) ? val.friends.map((f: any) => ({ friendRowId: Number(f.friendRowId ?? 0), userId: Number(f.userId ?? 0), friendId: Number(f.friendId ?? 0), status: f.status ?? 'pending' })) : [],
    rsvps: Array.isArray(val.rsvps) ? val.rsvps.map((r: any) => ({ rsvpId: Number(r.rsvpId ?? 0), createdAt: r.createdAt ?? '', eventId: Number(r.eventId ?? 0), eventOwnerId: Number(r.eventOwnerId ?? 0), inviteRecipientId: Number(r.inviteRecipientId ?? 0), status: r.status ?? 'pending', updatedAt: r.updatedAt ?? '' })) : [],
    user_prefs: Array.isArray(val.user_prefs) ? val.user_prefs.map((p: any) => ({ preferenceId: Number(p.preferenceId ?? 0), userId: Number(p.userId ?? 0), colorScheme: Number(p.colorScheme ?? 0), notificationEnabled: Number(p.notificationEnabled ?? 1), theme: Number(p.theme ?? 0), updatedAt: p.updatedAt ?? '' })) : [],
    events: Array.isArray(val.events) ? val.events.map((e: any) => ({ eventId: Number(e.eventId ?? 0), userId: Number(e.userId ?? 0), eventTitle: e.eventTitle ?? e.title ?? '', description: e.description ?? '', startTime: e.startTime ?? '', endTime: e.endTime ?? '', date: e.date ?? '', isEvent: Number(e.isEvent ?? 1), recurring: Number(e.recurring ?? 0) })) : [],
    notifications: Array.isArray(val.notifications) ? val.notifications.map((n: any) => ({ notificationId: Number(n.notificationId ?? 0), userId: Number(n.userId ?? 0), notifMsg: n.notifMsg ?? '', notifType: n.notifType ?? '', createdAt: n.createdAt ?? '' })) : [],
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
  const doSave = async () => {
    try {
      await storage.setItem(FALLBACK_KEY, db);
    } catch (e) {
      console.warn('db.saveFallback: failed to persist fallback DB', e);
    }
  };

  if (fallbackSaveLock) {
    // chain onto existing save to serialize writes
    fallbackSaveLock = fallbackSaveLock.then(doSave, doSave);
  } else {
    fallbackSaveLock = doSave();
  }

  try { await fallbackSaveLock; } catch { /* already logged */ }
  fallbackSaveLock = null;
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
    date TEXT DEFAULT '',
    description TEXT DEFAULT '',
    endTime TEXT DEFAULT '',
    eventTitle TEXT DEFAULT '',
    isEvent INTEGER DEFAULT 1,
    recurring INTEGER DEFAULT 0,
    startTime TEXT DEFAULT '',
    userId INTEGER DEFAULT 0
  );`);

  await execSqlNative(nativeDb, `CREATE TABLE IF NOT EXISTS friends (
    friendRowId INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER DEFAULT 0,
    friendId INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending'
  );`);

  await execSqlNative(nativeDb, `CREATE TABLE IF NOT EXISTS rsvps (
    rsvpId INTEGER PRIMARY KEY AUTOINCREMENT,
    createdAt TEXT DEFAULT '',
    eventId INTEGER DEFAULT 0,
    eventOwnerId INTEGER DEFAULT 0,
    inviteRecipientId INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    updatedAt TEXT DEFAULT ''
  );`);

  await execSqlNative(nativeDb, `CREATE TABLE IF NOT EXISTS user_prefs (
    preferenceId INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER DEFAULT 0,
    colorScheme INTEGER DEFAULT 0,
    notificationEnabled INTEGER DEFAULT 1,
    theme INTEGER DEFAULT 0,
    updatedAt TEXT DEFAULT ''
  );`);

  await execSqlNative(nativeDb, `CREATE TABLE IF NOT EXISTS users (
    userId INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT DEFAULT '',
    username TEXT DEFAULT ''
  );`);
  // Add phone_number column with default to avoid missing fields on native DB
  try {
    await execSqlNative(nativeDb, `ALTER TABLE users ADD COLUMN phone_number TEXT DEFAULT ''`);
  } catch (e) {
    // ignore if column already exists or ALTER not supported
  }
  // Add firebase_uid column to store provider-specific UID for sign-in mapping
  try {
    await execSqlNative(nativeDb, `ALTER TABLE users ADD COLUMN firebase_uid TEXT DEFAULT ''`);
  } catch (e) {
    // ignore if column already exists or ALTER not supported
  }
  // Add remote_user_id to store backend/server-side user id mapping
  try {
    await execSqlNative(nativeDb, `ALTER TABLE users ADD COLUMN remote_user_id TEXT DEFAULT ''`);
  } catch (e) {
    // ignore if column already exists or ALTER not supported
  }

  await execSqlNative(nativeDb, `CREATE TABLE IF NOT EXISTS notifications (
    notificationId INTEGER PRIMARY KEY AUTOINCREMENT,
    notifMsg TEXT DEFAULT '',
    userId INTEGER DEFAULT 0,
    notifType TEXT DEFAULT '',
    createdAt TEXT DEFAULT ''
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
  firebase_uid?: string | null;
  remote_user_id?: string | null;
}, opts?: { suppressOutbound?: boolean }): Promise<number> {
  await tryInitNative();
  let userId: number;
  
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'INSERT INTO users (email, username, phone_number, firebase_uid, remote_user_id) VALUES (?, ?, ?, ?, ?);', [user.email ?? '', user.username ?? '', user.phone_number ?? '', user.firebase_uid ?? '', user.remote_user_id ?? '']);
    userId = res.insertId ?? 0;
  } else {
    const db = await loadFallback();
    userId = nextId(db, 'users');
    db.users.push({ userId, username: user.username ?? '', email: user.email ?? '', phone_number: user.phone_number ?? '', firebase_uid: user.firebase_uid ?? '', remote_user_id: user.remote_user_id ?? '' });
    await saveFallback(db);
  }
  
  // Sync to Firebase (using numeric userId as key)
  if (FirebaseSync.isFirebaseSyncEnabled() && userId) {
    try {
      await FirebaseSync.syncUserToFirebase({ 
        userId,
        username: user.username ?? '',
        email: user.email ?? '',
        phone_number: user.phone_number ?? null,
        remote_user_id: user.remote_user_id ?? null,
      });
    } catch (error) {
      console.warn('Failed to sync user to Firebase:', error);
    }
  }
  // Emit outbound user created event so sync layer can push to backend API
  try {
    if (!opts || !opts.suppressOutbound) {
      emit('outbound:userCreated', { userId, username: user.username ?? '', email: user.email ?? '', firebase_uid: user.firebase_uid ?? '', remote_user_id: user.remote_user_id ?? '' });
    }
  } catch (_) { }
  
  return userId;
}

// NOTE: We now optionally store a provider-specific `firebase_uid` on local users
// to support mapping Firebase-authenticated users to numeric local `userId` values.
// This value is optional and not used as the authoritative identity — numeric
// `userId` remains the primary local identifier.

export async function resolveLocalUserId(): Promise<number | null> {
  try {
    const storedId = await storage.getItem<any>('userId');
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

// Repair helper: when backend/client previously stored provider UIDs in the
// `username` column (and `firebase_uid` is empty), migrate those values into
// `firebase_uid` and create a friendlier username derived from email or a
// generated handle. Returns the number of rows updated.
export async function repairFirebaseUidUsernames(): Promise<number> {
  const looksLikeUid = (v: any) => {
    if (!v) return false;
    try {
      const s = String(v);
      if (s.includes('@') || s.includes(' ')) return false;
      return /^[A-Za-z0-9_-]{12,256}$/.test(s);
    } catch { return false; }
  };

  await tryInitNative();
  let updated = 0;
  if (useNative && nativeDb) {
    const all: any = await execSqlNative(nativeDb, 'SELECT * FROM users;');
    for (const u of (all.rows._array as any[])) {
      try {
        if ((!u.firebase_uid || String(u.firebase_uid).trim().length === 0) && looksLikeUid(u.username)) {
          const newFid = String(u.username);
          let newName = '';
          if (u.email && String(u.email).includes('@')) newName = String(u.email).split('@')[0]; else newName = `u${Date.now()}`;
          await execSqlNative(nativeDb, 'UPDATE users SET firebase_uid = ?, username = ? WHERE userId = ?;', [newFid, newName, u.userId]);
          updated++;
        }
      } catch (e) { /* ignore per-row errors */ }
    }
    return updated;
  }

  const db = await loadFallback();
  for (let i = 0; i < db.users.length; i++) {
    const u = db.users[i];
    try {
      if ((!u.firebase_uid || String(u.firebase_uid).trim().length === 0) && looksLikeUid(u.username)) {
        const newFid = String(u.username);
        let newName = '';
        if (u.email && String(u.email).includes('@')) newName = String(u.email).split('@')[0]; else newName = `u${Date.now()}`;
        db.users[i] = { ...u, firebase_uid: newFid, username: newName };
        updated++;
      }
    } catch (e) { /* ignore per-row errors */ }
  }
  if (updated > 0) await saveFallback(db);
  return updated;
}

export async function getUserByFirebaseUid(firebaseUid: string): Promise<any | null> {
  if (!firebaseUid) return null;
  await tryInitNative();
  if (useNative && nativeDb) {
    try {
      const res: any = await execSqlNative(nativeDb, 'SELECT * FROM users WHERE firebase_uid = ? LIMIT 1;', [firebaseUid]);
      return (res.rows._array as any[])[0] ?? null;
    } catch {
      // fall through to fallback
    }
  }
  const db = await loadFallback();
  return db.users.find((u: any) => String(u.firebase_uid ?? u.firebaseUid ?? '') === String(firebaseUid)) ?? null;
}

export async function getUserByRemoteId(remoteId: string | number): Promise<any | null> {
  if (remoteId == null) return null;
  await tryInitNative();
  const rid = String(remoteId);
  if (useNative && nativeDb) {
    try {
      const res: any = await execSqlNative(nativeDb, 'SELECT * FROM users WHERE remote_user_id = ? LIMIT 1;', [rid]);
      return (res.rows._array as any[])[0] ?? null;
    } catch {
      // fall through to fallback
    }
  }
  const db = await loadFallback();
  return db.users.find((u: any) => String(u.remote_user_id ?? '') === rid) ?? null;
}

export async function updateUser(userId: number, updates: { username?: string; email?: string; phone_number?: string | null }) {
  await tryInitNative();
  
  if (useNative && nativeDb) {
    const sets: string[] = [];
    const params: any[] = [];
    if (updates.username !== undefined) { sets.push('username = ?'); params.push(updates.username); }
    if (updates.email !== undefined) { sets.push('email = ?'); params.push(updates.email); }
    if (updates.username !== undefined) { /* handled above */ }
    if (updates.phone_number !== undefined) { sets.push('phone_number = ?'); params.push(updates.phone_number ?? ''); }
    if ((updates as any).firebase_uid !== undefined) { sets.push('firebase_uid = ?'); params.push((updates as any).firebase_uid ?? ''); }
    if ((updates as any).remote_user_id !== undefined) { sets.push('remote_user_id = ?'); params.push((updates as any).remote_user_id ?? ''); }
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
      // Update user in Firebase by numeric userId
      await FirebaseSync.updateUserInFirebase(userId, updates);
    } catch (error) {
      console.warn('Failed to update user in Firebase:', error);
    }
  }
  // Emit outbound user updated so sync layer can push changes to backend
  try { emit('outbound:userUpdated', { userId, updates }); } catch (_) { }
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

// UPDATED sendFriendRequest - Send to API immediately
export async function sendFriendRequest(userId: number, friendId: number): Promise<number> {
  console.log('=== sendFriendRequest ===');
  console.log('userId (sender):', userId);
  console.log('friendId (receiver):', friendId);
  
  await tryInitNative();
  let friendRowId: number;
  
  // STEP 1: Send to API first (for immediate cross-account sync)
  try {
    const apiUrl = `${API_BASE_URL}/api/friends/request`;
    console.log('Sending to API:', apiUrl);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: String(userId),
        friendId: String(friendId)
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('API response:', result);
      
      // Extract the friendRowId from API response
      friendRowId = result.id || result.friendshipId || result.friendRowId || 0;
      console.log('Friend request created with ID:', friendRowId);
    } else {
      throw new Error(`API returned ${response.status}`);
    }
  } catch (error) {
    console.error('Failed to send friend request to API:', error);
    throw error; // Don't proceed if API fails
  }
  
  // STEP 2: Store in local database for offline access
  if (useNative && nativeDb) {
    try {
      await execSqlNative(
        nativeDb, 
        'INSERT OR REPLACE INTO friends (friendRowId, userId, friendId, status) VALUES (?, ?, ?, ?);', 
        [friendRowId, userId, friendId, 'pending']
      );
    } catch (e) {
      console.warn('Failed to store in local DB:', e);
    }
  } else {
    const db = await loadFallback();
    // Check if already exists
    const existingIndex = db.friends.findIndex((f: any) => f.friendRowId === friendRowId);
    if (existingIndex === -1) {
      db.friends.push({ friendRowId, userId, friendId, status: 'pending' });
      await saveFallback(db);
    }
  }
  
  // STEP 3: Sync to Firebase (if needed - API might already do this)
  if (FirebaseSync.isFirebaseSyncEnabled() && friendRowId) {
    try {
      await FirebaseSync.syncFriendRequestToFirebase({ 
        friendRowId, 
        userId, 
        friendId, 
        status: 'pending' 
      });
    } catch (error) {
      console.warn('Failed to sync friend request to Firebase:', error);
    }
  }
  
  // STEP 4: Emit event for other listeners
  try { 
    emit('outbound:friendCreated', { 
      friendRowId, 
      userId, 
      friendId, 
      status: 'pending' 
    }); 
  } catch (_) { }
  
  return friendRowId;
}

// BONUS: Add this helper to accept/decline friend requests
export async function respondToFriendRequest(
  friendRowId: number, 
  accept: boolean
): Promise<void> {
  console.log('=== respondToFriendRequest CALLED ===');
  console.log('friendRowId:', friendRowId);
  console.log('Type:', typeof friendRowId);
  console.log('accept:', accept);
  
  const newStatus = accept ? 'accepted' : 'declined';
  
  // Update via API
  try {
    if (accept) {
      // Accept the friend request
      const apiUrl = `${API_BASE_URL}/api/friends/${friendRowId}/accept`;
      console.log('Accepting friend request via API:', apiUrl);
      const response = await fetch(apiUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
    } else {
      // Decline/delete the friend request
      const apiUrl = `${API_BASE_URL}/api/friends/${friendRowId}`;
      console.log('Declining friend request via API:', apiUrl);
      const response = await fetch(apiUrl, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
    }
    
    console.log('Friend request updated via API');
  } catch (error) {
    console.error('Failed to update via API:', error);
    throw error;
  }
  
  // Update local database
  await tryInitNative();
  if (accept) {
    // Update status to accepted
    if (useNative && nativeDb) {
      await execSqlNative(
        nativeDb,
        'UPDATE friends SET status = ? WHERE friendRowId = ?;',
        [newStatus, friendRowId]
      );
    } else {
      const db = await loadFallback();
      const friend = db.friends.find((f: any) => f.friendRowId === friendRowId);
      if (friend) {
        friend.status = newStatus;
        await saveFallback(db);
      }
    }
  } else {
    // Delete the friend request
    if (useNative && nativeDb) {
      await execSqlNative(
        nativeDb,
        'DELETE FROM friends WHERE friendRowId = ?;',
        [friendRowId]
      );
    } else {
      const db = await loadFallback();
      db.friends = db.friends.filter((f: any) => f.friendRowId !== friendRowId);
      await saveFallback(db);
    }
  }
  
  // Sync to Firebase if needed
  if (FirebaseSync.isFirebaseSyncEnabled()) {
    try {
      if (accept) {
        await FirebaseSync.updateFriendRequestInFirebase(friendRowId, newStatus);
      }
    } catch (error) {
      console.warn('Failed to sync to Firebase:', error);
    }
  }
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
  console.log('=== getFriendRequestsForUser ===');
  console.log('userId:', userId);
  
  await tryInitNative();
  
  // STEP 1: Fetch from API to get latest data
  try {
    const apiUrl = `${API_BASE_URL}/api/friends/pending/${userId}`;
    console.log('Fetching from API:', apiUrl);
    
    const response = await fetch(apiUrl);
    if (response.ok) {
      const apiData = await response.json();
      console.log('API returned friend requests:', apiData);
      
      // Filter for incoming requests (where this user is the friendId)
      // Handle both string and number types
      const incoming = (apiData || []).filter((req: any) => {
        const match = String(req.friendId) === String(userId) && req.status === 'pending';
        console.log(`Checking: friendId=${req.friendId}, userId=${userId}, status=${req.status}, match=${match}`);
        return match;
      });
      
      console.log('Filtered incoming requests:', incoming);
      
      // STEP 2: Optionally sync to local database for offline access
      if (useNative && nativeDb) {
        for (const req of incoming) {
          try {
            // Check if already exists locally
            const existing: any = await execSqlNative(
              nativeDb, 
              'SELECT * FROM friends WHERE friendRowId = ?;', 
              [req.friendRowId || req.id]
            );
            
            if (existing.rows._array.length === 0) {
              // Insert into local DB
              await execSqlNative(
                nativeDb,
                'INSERT OR REPLACE INTO friends (friendRowId, userId, friendId, status) VALUES (?, ?, ?, ?);',
                [req.friendRowId || req.id, req.userId, req.friendId, req.status]
              );
            }
          } catch (e) {
            console.warn('Failed to sync friend request to local DB:', e);
          }
        }
      }
      
      return incoming;
    }
  } catch (error) {
    console.warn('Failed to fetch from API, falling back to local:', error);
  }
  
  // STEP 3: Fallback to local database if API fails
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(
      nativeDb, 
      'SELECT * FROM friends WHERE friendId = ? AND status = ?;', 
      [userId, 'pending']
    );
    console.log('Local DB results:', res.rows._array);
    return res.rows._array as any[];
  }
  
  const db = await loadFallback();
  const local = db.friends.filter((f: any) => 
    String(f.friendId) === String(userId) && f.status === 'pending'
  );
  console.log('Fallback DB results:', local);
  return local;
}

export async function getFriendsForUser(userId: number): Promise<any[]> {
  console.log('=== getFriendsForUser ===');
  console.log('userId:', userId);
  
  await tryInitNative();
  
  // STEP 1: Fetch from API to get latest friends
  try {
    const apiUrl = `${API_BASE_URL}/api/friends/user/${userId}`;
    console.log('Fetching friends from API:', apiUrl);
    
    const response = await fetch(apiUrl);
    if (response.ok) {
      const apiData = await response.json();
      console.log('API returned friends:', apiData);
      
      // Filter for accepted friends only
      const acceptedFriends = (apiData || []).filter((f: any) => f.status === 'accepted');
      console.log('Accepted friends:', acceptedFriends);
      
      // STEP 2: Sync to local database
      if (useNative && nativeDb) {
        for (const friend of acceptedFriends) {
          try {
            await execSqlNative(
              nativeDb,
              'INSERT OR REPLACE INTO friends (friendRowId, userId, friendId, status) VALUES (?, ?, ?, ?);',
              [friend.friendRowId || friend.id, friend.userId, friend.friendId, friend.status]
            );
          } catch (e) {
            console.warn('Failed to sync friend to local DB:', e);
          }
        }
      }
      
      return acceptedFriends;
    }
  } catch (error) {
    console.warn('Failed to fetch friends from API, falling back to local:', error);
  }
  
  // STEP 3: Fallback to local database if API fails
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(
      nativeDb, 
      'SELECT * FROM friends WHERE (userId = ? OR friendId = ?) AND status = ?;', 
      [userId, userId, 'accepted']
    );
    console.log('Local DB friends:', res.rows._array);
    return res.rows._array as any[];
  }
  
  const db = await loadFallback();
  const localFriends = db.friends.filter((f: any) => 
    (f.userId === userId || f.friendId === userId) && f.status === 'accepted'
  );
  console.log('Fallback DB friends:', localFriends);
  return localFriends;
}

// Return all friend rows referencing the given user (accepted or pending)
export async function getFriendRowsForUser(userId: number): Promise<any[]> {
  await tryInitNative();
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(nativeDb, 'SELECT * FROM friends WHERE userId = ? OR friendId = ?;', [userId, userId]);
    return res.rows._array as any[];
  }
  const db = await loadFallback();
  return db.friends.filter((f: any) => Number(f.userId) === Number(userId) || Number(f.friendId) === Number(userId));
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
  console.log('=== createRsvp ===');
  console.log('Creating RSVP:', rsvp);
  
  await tryInitNative();
  let rsvpId: number;
  
  // STEP 1: Send to API first (for immediate cross-account sync)
  try {
    const apiUrl = `${API_BASE_URL}/api/rsvps/invite`;
    console.log('Sending RSVP to API:', apiUrl);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: String(rsvp.eventId),
        userId: String(rsvp.inviteRecipientId)  // ✅ Change "inviteRecipientId" to "userId"
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('API response:', result);
      
      // Extract the rsvpId from API response
      rsvpId = result.rsvpId || result.id || 0;
      console.log('RSVP created with ID:', rsvpId);
    } else {
      throw new Error(`API returned ${response.status}`);
    }
  } catch (error) {
    console.error('Failed to send RSVP to API:', error);
    throw error; // Don't proceed if API fails
  }
  
  // STEP 2: Store in local database for offline access
  const now = new Date().toISOString();
  
  if (useNative && nativeDb) {
    try {
      await execSqlNative(
        nativeDb, 
        'INSERT OR REPLACE INTO rsvps (rsvpId, eventId, eventOwnerId, inviteRecipientId, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?);', 
        [rsvpId, rsvp.eventId, rsvp.eventOwnerId, rsvp.inviteRecipientId, rsvp.status ?? 'no-reply', now, now]
      );
    } catch (e) {
      console.warn('Failed to store in local DB:', e);
    }
  } else {
    const db = await loadFallback();
    // Check if already exists
    const existingIndex = db.rsvps.findIndex((r: any) => r.rsvpId === rsvpId);
    if (existingIndex === -1) {
      db.rsvps.push({ rsvpId, ...rsvp, createdAt: now, updatedAt: now });
      await saveFallback(db);
    }
  }
  
  // STEP 3: Sync to Firebase (if needed - API might already do this)
  if (FirebaseSync.isFirebaseSyncEnabled() && rsvpId) {
    try {
      await FirebaseSync.syncRsvpToFirebase({ rsvpId, ...rsvp });
    } catch (error) {
      console.warn('Failed to sync RSVP to Firebase:', error);
    }
  }
  
  // Emit event
  try { emit('outbound:rsvpCreated', { rsvpId, ...rsvp }); } catch (_) { }
  
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
  console.log('=== getRsvpsForUser ===');
  console.log('userId:', userId);
  
  await tryInitNative();
  
  // STEP 1: Fetch from API to get latest RSVPs
  try {
    const apiUrl = `${API_BASE_URL}/api/rsvps/user/${userId}`;
    console.log('Fetching RSVPs from API:', apiUrl);
    
    const response = await fetch(apiUrl);
    if (response.ok) {
      const apiData = await response.json();
      console.log('API returned RSVPs:', apiData);
      
      // Filter for RSVPs where this user is the inviteRecipientId
      // Handle both string and number types
      const userRsvps = (apiData || []).filter((rsvp: any) => 
        String(rsvp.inviteRecipientId) === String(userId)
      );
      console.log('Filtered RSVPs for user:', userRsvps);
      
      // STEP 2: Sync to local database
      if (useNative && nativeDb) {
        for (const rsvp of userRsvps) {
          try {
            await execSqlNative(
              nativeDb,
              'INSERT OR REPLACE INTO rsvps (rsvpId, eventId, eventOwnerId, inviteRecipientId, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?);',
              [
                rsvp.rsvpId || rsvp.id, 
                rsvp.eventId, 
                rsvp.eventOwnerId, 
                rsvp.inviteRecipientId, 
                rsvp.status,
                rsvp.createdAt || new Date().toISOString(),
                rsvp.updatedAt || new Date().toISOString()
              ]
            );
          } catch (e) {
            console.warn('Failed to sync RSVP to local DB:', e);
          }
        }
      }
      
      return userRsvps;
    }
  } catch (error) {
    console.warn('Failed to fetch RSVPs from API, falling back to local:', error);
  }
  
  // STEP 3: Fallback to local database if API fails
  if (useNative && nativeDb) {
    const res: any = await execSqlNative(
      nativeDb, 
      'SELECT * FROM rsvps WHERE inviteRecipientId = ? OR eventOwnerId = ?;', 
      [userId, userId]
    );
    console.log('Local DB RSVPs:', res.rows._array);
    return res.rows._array as any[];
  }
  
  const db = await loadFallback();
  const localRsvps = db.rsvps.filter((r: any) => 
    r.inviteRecipientId === userId || r.eventOwnerId === userId
  );
  console.log('Fallback DB RSVPs:', localRsvps);
  return localRsvps;
}

export async function updateRsvp(rsvpId: number, updates: { status?: string; }) {
  console.log('=== updateRsvp ===');
  console.log('rsvpId:', rsvpId);
  console.log('updates:', updates);
  
  await tryInitNative();
  const now = new Date().toISOString();
  
  // STEP 1: Update via API
  try {
    const apiUrl = `${API_BASE_URL}/api/rsvps/${rsvpId}/status`;
    console.log('Updating RSVP via API:', apiUrl);
    
    const response = await fetch(apiUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: updates.status
      })
    });
    
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    
    console.log('RSVP updated via API');
  } catch (error) {
    console.error('Failed to update RSVP via API:', error);
    throw error;
  }
  
  // STEP 2: Update local database
  if (useNative && nativeDb) {
    await execSqlNative(
      nativeDb, 
      'UPDATE rsvps SET status = ?, updatedAt = ? WHERE rsvpId = ?;', 
      [updates.status, now, rsvpId]
    );
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
    const res: any = await execSqlNative(nativeDb, 'INSERT INTO events (userId, eventTitle, description, startTime, endTime, isEvent, recurring, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?);', [event.userId ?? 0, title ?? '', event.description ?? '', event.startTime ?? '', event.endTime ?? '', event.isEvent ?? 1, event.recurring ?? 0, event.date ?? '']);
    eventId = res.insertId ?? 0;
  } else {
    const db = await loadFallback();
    eventId = nextId(db, 'events');
    db.events.push({ eventId, userId: Number(event.userId ?? 0), eventTitle: title ?? '', description: event.description ?? '', startTime: event.startTime ?? '', endTime: event.endTime ?? '', date: event.date ?? '', isEvent: Number(event.isEvent ?? 1), recurring: Number(event.recurring ?? 0) });
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
    const res: any = await execSqlNative(nativeDb, 'INSERT INTO notifications (userId, notifMsg, notifType, createdAt) VALUES (?, ?, ?, ?);', [note.userId ?? 0, note.notifMsg ?? '', note.notifType ?? '', note.timestamp ?? new Date().toISOString()]);
    notificationId = res.insertId ?? 0;
  } else {
    const db = await loadFallback();
    notificationId = nextId(db, 'notifications');
    db.notifications.push({ notificationId, userId: Number(note.userId ?? 0), notifMsg: note.notifMsg ?? '', notifType: note.notifType ?? '', createdAt: note.timestamp ?? new Date().toISOString() });
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
      db.user_prefs.push({ preferenceId: nextId(db, 'user_prefs'), userId: Number(userId ?? 0), theme: prefs.theme ?? 0, notificationEnabled: prefs.notificationEnabled ?? 1, colorScheme: prefs.colorScheme ?? 0, updatedAt: new Date().toISOString() });
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
  // Emit an outbound event to let sync push these preferences to backend
  try { emit('outbound:preferencesUpdated', { userId, prefs }); } catch (_) { }
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
    if (u && u.username && String(u.username).trim().length > 0) s += 10;
    if (u && u.email && String(u.email).trim().length > 0) s += 1;
    return s;
  };
  // NOTE: We no longer use provider-specific IDs for grouping; fall back to email/name grouping below

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

  // 3) Group by username (fallback) for users missing email
  const byName: { [name: string]: any[] } = {};
  users.forEach((u: any) => {
    const rawEmail = extractEmail(u);
    const hasEmail = !!(rawEmail && String(rawEmail).trim().length > 0);
    if (hasEmail) return; // skip users with email; they were handled above
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

  // Disable Firebase sync while performing destructive local merges to avoid
  // races where local deletes/rewrites are immediately pushed and re-create
  // duplicates or inconsistent state on the backend. We restore the prior
  // setting in a finally block below.
  const prevSync = FirebaseSync.isFirebaseSyncEnabled();
  try {
    FirebaseSync.setFirebaseSyncEnabled(false);

    // Prefer keeper selection policy: if the `removeId` row has a provider-specific id
    // but the `keepId` row does not, swap them so we keep the row with that provider id.
    try {
      // Probe both users to allow potential swap logic in future; currently we
      // just ensure lookups don't throw and continue.
      const a = await getUserById(keepId);
      const b = await getUserById(removeId);
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
  try {
    await deleteUser(removeId);
  } catch (e) {
    console.warn('db.mergeUsers: failed to delete removed user', removeId, e);
  }
  
  // end of merge operations — local DB has been adjusted without pushing to Firebase
  return;
  } finally {
    // Restore previous Firebase sync setting
    try {
      FirebaseSync.setFirebaseSyncEnabled(prevSync);
      console.log('db.mergeUsers: restored Firebase sync to', prevSync);
    } catch (e) {
      console.warn('db.mergeUsers: failed to restore Firebase sync flag', e);
    }
  }
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

// One-time migration: backfill provider-specific id fields across fallback/native tables
export async function backfillFirebaseUids(): Promise<any> {
  // Removed: backfillFirebaseUids — provider-specific IDs are no longer tracked locally
  throw new Error('backfillFirebaseUids() removed: local storage no longer tracks provider-specific IDs');
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
  respondToFriendRequest,
  getFriendRequestsForUser,
  getFriendsForUser,
  getFriendRowsForUser,
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
  resolveLocalUserId,
  getAllUsers,
  getUserByFirebaseUid,
  repairFirebaseUidUsernames,
  // Dedupe helpers
  findUserDuplicates,
  mergeUsers,
  runDuplicateCleanup,

  getStatus,
};