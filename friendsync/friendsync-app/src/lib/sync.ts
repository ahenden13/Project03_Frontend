// this script syncs the backend to the frontend db

import * as db from './db';
import FirebaseSync from './firebaseSync';
import { on } from './eventBus';

// Heuristic to detect when a string is actually a provider UID (e.g. Firebase)
function looksLikeFirebaseUid(v: any): boolean {
  if (!v) return false;
  try {
    const s = String(v);
    // reject obvious emails or spaced names
    if (s.includes('@') || s.includes(' ')) return false;
    // typical firebase UIDs are long alpha-num strings; use length heuristic
    return /^[A-Za-z0-9_-]{12,256}$/.test(s);
  } catch { return false; }
}

// backend URL
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://project03-friendsync-backend-8c893d18fe37.herokuapp.com';

// How often to sync (5 minutes)
const SYNC_INTERVAL = 5 * 60 * 1000;

let syncTimer: ReturnType<typeof setInterval> | null = null;
let authToken: string | null = null;
/**
 * Set the auth token for API requests
 */
export function setAuthToken(token: string) {
  authToken = token;
}

// Listen for outbound local changes and push them to the backend API when available.
on('outbound:friendCreated', async (payload: any) => {
  try {
    const body = { friendRowId: payload.friendRowId, userId: payload.userId, friendId: payload.friendId, status: payload.status };
    const headers: any = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    await fetch(`${API_URL}/api/friends`, { method: 'POST', headers, body: JSON.stringify(body) }).catch(() => null);
    console.log('sync: pushed friend to backend', body);
  } catch (e) { console.warn('sync: failed pushing friend to backend', e); }
});

on('outbound:rsvpCreated', async (payload: any) => {
  try {
    const body = { rsvpId: payload.rsvpId, eventId: payload.eventId, eventOwnerId: payload.eventOwnerId, inviteRecipientId: payload.inviteRecipientId, status: payload.status };
    const headers: any = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    await fetch(`${API_URL}/api/rsvps`, { method: 'POST', headers, body: JSON.stringify(body) }).catch(() => null);
    console.log('sync: pushed rsvp to backend', body);
  } catch (e) { console.warn('sync: failed pushing rsvp to backend', e); }
});

on('outbound:preferencesUpdated', async (payload: any) => {
  try {
    const body = { userId: payload.userId, ...payload.prefs };
    const headers: any = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    await fetch(`${API_URL}/api/user-prefs`, { method: 'POST', headers, body: JSON.stringify(body) }).catch(() => null);
    console.log('sync: pushed prefs to backend', body);
  } catch (e) { console.warn('sync: failed pushing prefs to backend', e); }
});

// Push created/updated users to backend so server has username and local userId
on('outbound:userCreated', async (payload: any) => {
  try {
    const body = { userId: payload.userId, username: payload.username, email: payload.email, firebase_uid: payload.firebase_uid };
    const headers: any = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    await fetch(`${API_URL}/api/users`, { method: 'POST', headers, body: JSON.stringify(body) }).catch(() => null);
    console.log('sync: pushed user created to backend', body);
  } catch (e) { console.warn('sync: failed pushing user to backend', e); }
});

on('outbound:userUpdated', async (payload: any) => {
  try {
    const body = { userId: payload.userId, ...payload.updates };
    const headers: any = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    // POST to users endpoint — backend should upsert by userId
    await fetch(`${API_URL}/api/users`, { method: 'POST', headers, body: JSON.stringify(body) }).catch(() => null);
    console.log('sync: pushed user updated to backend', body);
  } catch (e) { console.warn('sync: failed pushing updated user to backend', e); }
});

/**
 * Make an authenticated request to the backend
 * takes in the endpoint string such as 'rsvps' or 'friends'
 */
async function fetchFromBackend(endpoint: string | number): Promise<any> {
  const headers: any = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const response = await fetch(`${API_URL}${endpoint}`, { headers });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${endpoint}: ${response.status}`);
  }

  return response.json();
}

/**
 * Sync all data from backend to local database
 */
export async function syncFromBackend(userId: number): Promise<void> {
  console.log('Starting sync...');
  console.log('syncFromBackend: target userId param=', userId);

  try {

    //convert userId to string for api calls — prefer server/backend id (remote_user_id) when available
    let userIdParam = String(userId);
    try {
      if (userId) {
        const localRow = await db.getUserById(Number(userId)).catch(() => null);
        if (localRow && localRow.remote_user_id && String(localRow.remote_user_id).trim().length > 0) {
          userIdParam = String(localRow.remote_user_id);
        }
      }
    } catch (e) { /* ignore and fall back to numeric id */ }
    // Resolve the provided userId (expect numeric local id)
    let localUserId: number | null = null;
    try {
      const asNum = Number(userId);
      if (Number.isFinite(asNum) && !Number.isNaN(asNum)) {
        localUserId = asNum;
      }
    } catch (e) {
      // ignore — we'll handle unresolved below
    }

    // If we still couldn't resolve, try the general resolver which checks storage mappings
    if (!localUserId) {
      try {
        const resolved = await db.resolveLocalUserId();
        if (resolved != null) localUserId = resolved;
      } catch (e) { /* ignore */ }
    }

    if (!localUserId) console.warn('syncFromBackend: could not resolve local user id for', userId, '(tried direct UID and storage)');

    // Fetch all data from backend
    // Pull global collections (not limited to a single user) so we can reconcile
    // data across all local users and avoid missing backend records tied to
    // other devices/accounts. Each endpoint should return all items.
    // Use user-scoped endpoints for friends, rsvps and preferences when possible
    // because some backends do not expose global collections for these.
    const [allUsers, events, friends, rsvps, notifications, preferences] = await Promise.all([
      fetchFromBackend(`/api/users`).catch(() => null),
      fetchFromBackend(`/api/events`).catch(() => []),
      // prefer per-user routes if we have a resolved local user id
      (localUserId ? fetchFromBackend(`/api/friends/user/${userIdParam}`).catch(() => []) : fetchFromBackend(`/api/friends`).catch(() => [])),
      (localUserId ? fetchFromBackend(`/api/rsvps/user/${userIdParam}`).catch(() => []) : fetchFromBackend(`/api/rsvps`).catch(() => [])),
      (localUserId ? fetchFromBackend(`/api/notifications/user/${userIdParam}`).catch(() => []) : fetchFromBackend(`/api/notifications`).catch(() => [])),
      (localUserId ? fetchFromBackend(`/api/user-prefs/user/${userIdParam}`).catch(() => null) : fetchFromBackend(`/api/preferences`).catch(() => null)),
    ]);

    if (Array.isArray(allUsers)) {
      console.log('syncFromBackend: fetched users count=', allUsers.length);
      for (const user of allUsers) {
        // Prefer matching by backend/server id first (remote_user_id), then numeric userId, then provider UID, then email
        let localMatch: any = null;
        try {
          const remoteId = user.userId ?? user.id ?? null;
          if (remoteId != null) {
            const byRemote = await db.getUserByRemoteId(remoteId).catch(() => null);
            if (byRemote) localMatch = byRemote;
          }
        } catch (e) { /* ignore */ }
        try {
          if (!localMatch && (user.userId || user.id)) localMatch = await db.getUserById(Number(user.userId ?? user.id));
        } catch (e) { /* ignore */ }
        // Prefer matching by provider UID when available
        try {
          if (!localMatch && (user.firebaseUid || user.firebase_uid || user.uid)) {
            const fid = user.firebaseUid ?? user.firebase_uid ?? user.uid;
            const byUid = await db.getUserByFirebaseUid(String(fid));
            if (byUid) localMatch = byUid;
          }
        } catch (e) { /* ignore */ }
        try {
          if (!localMatch && user.email) localMatch = await db.getUserByEmail(user.email);
        } catch (e) { /* ignore */ }

        if (localMatch && localMatch.userId) {
          // Update the local row (keep identity mapping by numeric id)
          const updates: any = {};
          // Use `username` from backend if provided. Do NOT overwrite a
          // non-empty local username with `displayName`. Only use
          // `displayName` when creating a new row or when the local
          // username is blank.
          const incomingUsername = user.username ?? null;
          const incomingDisplayName = user.displayName ?? null;

          if (incomingUsername != null) {
            const uname = String(incomingUsername).trim();
            if (uname.length > 0 && uname !== String(localMatch.username ?? '')) updates.username = uname;
          } else if ((!localMatch.username || String(localMatch.username).trim().length === 0) && incomingDisplayName) {
            // local username blank — set it from displayName
            const uname = String(incomingDisplayName).trim();
            if (uname.length > 0) updates.username = uname;
          }

          if (user.email !== undefined && user.email !== localMatch.email) updates.email = user.email;
          // If the backend provides a provider UID, persist it non-destructively
          const fid = user.firebaseUid ?? user.firebase_uid ?? user.uid ?? null;
          if (fid && String(localMatch.firebase_uid ?? '').trim().length === 0) updates.firebase_uid = String(fid);
          // Persist backend/server id mapping if provided and missing locally
          if ((user.userId ?? user.id ?? null) && (!localMatch.remote_user_id || String(localMatch.remote_user_id).trim().length === 0)) {
            updates.remote_user_id = String(user.userId ?? user.id ?? '');
          }

          if (Object.keys(updates).length > 0) {
            await db.updateUser(Number(localMatch.userId), updates);
            console.log(`syncFromBackend: updated local user ${localMatch.userId} (${updates.username ?? '(no username)'} )`);
          }
        } else {
          // create new local user (include firebase UID if provided)
          // Conservative creation: only create a local user when the backend
          // record includes at least one stable external identifier we can
          // reasonably map: either an email or a provider UID. A numeric
          // backend id alone is not sufficient because it often refers to
          // server-side primary keys and will produce noisy placeholder users.
          const fid = user.firebaseUid ?? user.firebase_uid ?? user.uid ?? null;
          const email = user.email ?? null;

          const unameRaw = user.username ?? (user.displayName ?? '') ?? '';
          const looksLikeGeneratedTimestamp = /^u\d{6,}$/.test(String(unameRaw));

          if (!fid && !email) {
            // Skip creating users that only have a numeric backend id or empty fields
            console.warn('syncFromBackend: skipping creation of backend user — no email or provider UID', { username: unameRaw, userId: user.userId ?? user.id });
          } else if (looksLikeGeneratedTimestamp && !fid && !email) {
            console.warn('syncFromBackend: skipping creation of generated-timestamp user', { username: unameRaw, userId: user.userId ?? user.id });
          } else {
            let uname = unameRaw;
            if (!uname || String(uname).trim().length === 0) {
              if (email) uname = String(email).split('@')[0];
              else if (fid) uname = `uid_${String(fid).slice(0,8)}`;
              else uname = `user_${String(Date.now())}`;
            }
            const newLocalId = await db.createUser({
              username: uname,
              email: email ?? '',
              password: undefined,
              phone_number: user.phoneNumber || user.phone_number || null,
              firebase_uid: fid,
              remote_user_id: String(user.userId ?? user.id ?? ''),
            }, { suppressOutbound: true });
            console.log(`syncFromBackend: created local user ${newLocalId} (${uname}) firebase_uid=${fid}`);
          }
        }
      }
      console.log(`✅ Synced ${allUsers.length} users`);
    }


    // Store events — create or update for each event owner. We will attempt to
    // resolve the backend event owner to a local numeric userId; if not found
    // we'll create a local user record to preserve ownership.
    console.log('syncFromBackend: processing all events, count=', (events || []).length);
    let createdEvents = 0; let updatedEvents = 0;
    for (const event of events) {
      try {
        // Resolve owner identity from event payload (try numeric id, provider uid, email)
        const ownerRemoteId = event.userId ?? event.ownerId ?? event.user_id ?? null;
        let ownerLocalId: number | null = null;
        try {
          if (ownerRemoteId != null) {
            const asNum = Number(ownerRemoteId);
            if (Number.isFinite(asNum) && !Number.isNaN(asNum)) {
              const u = await db.getUserById(asNum);
              if (u && u.userId) ownerLocalId = Number(u.userId);
            }
          }
        } catch {}

        if (!ownerLocalId && (event.firebaseUid || event.firebase_uid || event.ownerUid)) {
          const byUid = await db.getUserByFirebaseUid(String(event.firebaseUid ?? event.firebase_uid ?? event.ownerUid));
          if (byUid && byUid.userId) ownerLocalId = Number(byUid.userId);
        }
        if (!ownerLocalId && event.ownerEmail) {
          const byEmail = await db.getUserByEmail(String(event.ownerEmail));
          if (byEmail && byEmail.userId) ownerLocalId = Number(byEmail.userId);
        }

        // If still unresolved, create a lightweight local user to own the event
        if (!ownerLocalId) {
          const fid = event.firebaseUid ?? event.firebase_uid ?? event.ownerUid ?? null;
          const remoteId = event.userId ?? event.ownerId ?? event.user_id ?? null;
          const email = event.ownerEmail ?? event.email ?? null;
          // Require either a provider UID or an email to create a local owner.
          if (!fid && !email) {
            // No stable external identifier for this owner — skip creating a placeholder
            console.warn('syncFromBackend: skipping event owner creation (no email or provider UID)', { ownerName: event.ownerName, remoteId });
            continue; // skip processing this event to avoid creating ephemeral users
          }
          let uname = event.ownerName || event.userName || event.username || '';
          if (!uname || String(uname).trim().length === 0) {
            if (email) uname = String(email).split('@')[0];
            else if (fid) uname = `uid_${String(fid).slice(0,8)}`;
            else uname = `user_${String(Date.now())}`;
          }
          // If uname itself looks like a UID and we don't have fid, treat it as fid
          let effectiveFid = fid;
          if (!effectiveFid && looksLikeFirebaseUid(uname)) {
            effectiveFid = String(uname);
            if (email) uname = String(email).split('@')[0]; else uname = `remote_${remoteId ?? Date.now()}`;
          }
          ownerLocalId = await db.createUser({ username: String(uname), email: email || '', firebase_uid: effectiveFid, remote_user_id: String(remoteId ?? '') }, { suppressOutbound: true });
        }

        // Now check if the event exists (global search by backend eventId)
        let exists: any = null;
        try {
          const asNumE = Number(event.eventId ?? event.id);
          if (Number.isFinite(asNumE) && !Number.isNaN(asNumE)) {
            // search across owner's events
            const evs = await db.getEventsForUser(ownerLocalId);
            exists = evs.find((x: any) => Number(x.eventId) === asNumE);
          }
        } catch {}

        if (!exists) {
          // best-effort match across owner's events by title+startTime
          try {
            const evs = await db.getEventsForUser(ownerLocalId);
            exists = evs.find((ev: any) => (ev.startTime === event.startTime) && ((ev.eventTitle || ev.title || '') === (event.eventTitle || event.title || '')) );
          } catch {}
        }

        if (!exists) {
          await db.createEvent({ userId: ownerLocalId, eventTitle: event.eventTitle || event.title, description: event.description, startTime: event.startTime, endTime: event.endTime, date: event.date, isEvent: event.isEvent ?? 1, recurring: event.recurring ?? 0 });
          createdEvents++;
        } else {
          const toUpdate: any = {};
          try {
            if ((event.eventTitle || event.title) && (exists.eventTitle !== (event.eventTitle || event.title))) toUpdate.eventTitle = event.eventTitle || event.title;
            if (event.description !== undefined && exists.description !== event.description) toUpdate.description = event.description;
            if (event.startTime !== undefined && exists.startTime !== event.startTime) toUpdate.startTime = event.startTime;
            if (event.endTime !== undefined && exists.endTime !== event.endTime) toUpdate.endTime = event.endTime;
            if (Object.keys(toUpdate).length > 0) { await db.updateEvent(Number(exists.eventId), toUpdate); updatedEvents++; }
          } catch (e) { /* ignore update errors */ }
        }
      } catch (e) {
        // per-event errors should not stop the sync
        console.warn('syncFromBackend: event processing failed', e);
      }
    }
    console.log(`syncFromBackend: events created=${createdEvents} updated=${updatedEvents}`);

    // Store friends — map backend ids to local ids where possible
    if (localUserId) {
      let createdFriends = 0; let updatedFriends = 0;
      for (const friend of friends) {
        // Map backend friend.friendId to local id if possible
        let friendLocalId: number | null = null;
        try {
          const asNum = Number(friend.friendId);
          if (Number.isFinite(asNum) && !Number.isNaN(asNum)) {
            const u = await db.getUserById(asNum);
            if (u && u.userId) friendLocalId = Number(u.userId);
          }
        } catch {}

        // Try provider UID or email to resolve/create a local user
        const fid = friend.firebaseUid ?? friend.firebase_uid ?? friend.uid ?? null;
        if (!friendLocalId && fid) {
          const byUid = await db.getUserByFirebaseUid(String(fid)).catch(() => null);
          if (byUid && byUid.userId) friendLocalId = Number(byUid.userId);
        }
        if (!friendLocalId && friend.email) {
          const u = await db.getUserByEmail(String(friend.email)).catch(() => null);
          if (u && u.userId) friendLocalId = Number(u.userId);
        }

        // If we still don't have a local numeric id, only proceed if we can create
        // a stable local user (requires email or provider UID). Otherwise skip.
        if (!friendLocalId) {
          if (fid || friend.email) {
            const uname = friend.username || (friend.displayName ? String(friend.displayName).split(' ').join('_').toLowerCase() : (friend.email ? String(friend.email).split('@')[0] : `user_${Date.now()}`));
            try {
              friendLocalId = await db.createUser({ username: String(uname), email: friend.email ?? '', password: undefined, phone_number: null, firebase_uid: fid, remote_user_id: friend.userId ?? friend.id ?? '' }, { suppressOutbound: true });
              console.log(`syncFromBackend: created placeholder local user for friend ${friendLocalId} (email=${friend.email}, fid=${fid})`);
            } catch (e) {
              console.warn('syncFromBackend: failed creating placeholder friend user', e);
              friendLocalId = null;
            }
          } else {
            console.warn('syncFromBackend: skipping friend entry — could not resolve or create local id for friend', friend);
            continue; // skip this friend entry
          }
        }

        // Find any existing friend row that references both users (either direction)
        const accepted = await db.getFriendsForUser(localUserId);
        const incoming = await db.getFriendRequestsForUser(localUserId);
        // also check outgoing requests (where local user is the requester)
        const outgoing = friendLocalId ? await db.getFriendRequestsForUser(friendLocalId).catch(() => []) : [];

        const combined = [...accepted, ...incoming, ...outgoing];
        const exists = combined.find((f: any) => (
          (Number(f.userId) === Number(localUserId) && Number(f.friendId) === Number(friendLocalId)) ||
          (Number(f.userId) === Number(friendLocalId) && Number(f.friendId) === Number(localUserId)) ||
          (f.friendRowId && friend.friendRowId && Number(f.friendRowId) === Number(friend.friendRowId))
        ));

        if (!exists) {
          await db.sendFriendRequest(localUserId, friendLocalId);
          createdFriends++;
          if (friend.status === 'accepted') {
            const requests = await db.getFriendRequestsForUser(localUserId);
            const request = requests.find((r: any) => r.friendId === friendLocalId);
            if (request) {
              await db.respondFriendRequest(request.friendRowId, true);
            }
          }
        } else {
          // If the backend reports a different status, update the local friend row accordingly
          try {
            const backendStatus = friend.status || friend.friendStatus || friend.state || null;
            if (backendStatus && exists.status !== backendStatus) {
              // use respondFriendRequest to ensure side-effects (RSVP creation on accept)
              await db.respondFriendRequest(exists.friendRowId, backendStatus === 'accepted');
              updatedFriends++;
            }
          } catch (e) {
            // ignore per-item errors
          }
        }
      }
      console.log('syncFromBackend: friends created=', createdFriends, ' updated=', updatedFriends);
    } else {
      console.warn('syncFromBackend: skipping friends because local user id could not be resolved for', userId);
    }

    // Store RSVPs — map backend ids to local ids where possible
    if (localUserId) {
      let createdRsvps = 0; let updatedRsvps = 0;
      for (const rsvp of rsvps) {
        // Map inviteRecipientId to local id (resolve by numeric id, uid, or email)
        let inviteeLocalId: number | null = null;
        try {
          const asNum = Number(rsvp.inviteRecipientId);
          if (Number.isFinite(asNum) && !Number.isNaN(asNum)) {
            const u = await db.getUserById(asNum);
            if (u && u.userId) inviteeLocalId = Number(u.userId);
          }
        } catch {}
        const inviteeFid = rsvp.inviteRecipientUid ?? rsvp.invite_recipient_uid ?? rsvp.inviteRecipientFirebaseUid ?? null;
        if (!inviteeLocalId && inviteeFid) {
          const byUid = await db.getUserByFirebaseUid(String(inviteeFid)).catch(() => null);
          if (byUid && byUid.userId) inviteeLocalId = Number(byUid.userId);
        }
        if (!inviteeLocalId && (rsvp.inviteRecipientEmail || rsvp.invite_recipient_email)) {
          const u = await db.getUserByEmail(String(rsvp.inviteRecipientEmail || rsvp.invite_recipient_email)).catch(() => null);
          if (u && u.userId) inviteeLocalId = Number(u.userId);
        }

        // Map event owner id to local id (resolve numeric id, uid, or email)
        let ownerLocalId: number | null = null;
        try {
          const asNumO = Number(rsvp.eventOwnerId);
          if (Number.isFinite(asNumO) && !Number.isNaN(asNumO)) {
            const uo = await db.getUserById(asNumO);
            if (uo && uo.userId) ownerLocalId = Number(uo.userId);
          }
        } catch {}
        const ownerFid = rsvp.eventOwnerUid ?? rsvp.event_owner_uid ?? null;
        if (!ownerLocalId && ownerFid) {
          const byUid = await db.getUserByFirebaseUid(String(ownerFid)).catch(() => null);
          if (byUid && byUid.userId) ownerLocalId = Number(byUid.userId);
        }
        if (!ownerLocalId && (rsvp.eventOwnerEmail || rsvp.event_owner_email)) {
          const byEmail = await db.getUserByEmail(String(rsvp.eventOwnerEmail || rsvp.event_owner_email)).catch(() => null);
          if (byEmail && byEmail.userId) ownerLocalId = Number(byEmail.userId);
        }

        // Map eventId: prefer to find a local event with same startTime+title for the event owner's local user id
        let localEventId: number | null = null;
        let ownerLocalIdForEvent: number | null = null;
        try {
          // Prefer numeric owner id when available
          const asNumO = Number(rsvp.eventOwnerId);
          if (Number.isFinite(asNumO) && !Number.isNaN(asNumO)) ownerLocalIdForEvent = asNumO;
        } catch (_) { ownerLocalIdForEvent = null; }
        if (!ownerLocalIdForEvent) {
          try { const asNumO = Number(rsvp.eventOwnerId); if (Number.isFinite(asNumO) && !Number.isNaN(asNumO)) ownerLocalIdForEvent = asNumO; } catch (_) { ownerLocalIdForEvent = null; }
        }

        try {
          // Try direct id match first against the owner's events
          const asNumE = Number(rsvp.eventId);
          if (Number.isFinite(asNumE) && !Number.isNaN(asNumE)) {
            const evs = ownerLocalIdForEvent ? await db.getEventsForUser(ownerLocalIdForEvent) : await db.getEventsForUser(localUserId);
            const ev = evs.find((x: any) => Number(x.eventId) === asNumE);
            if (ev) localEventId = Number(ev.eventId);
          }
        } catch {}
        if (!localEventId) {
          // Best-effort: match by title+startTime among the owner's events
          try {
            const candidates = ownerLocalIdForEvent ? await db.getEventsForUser(ownerLocalIdForEvent) : await db.getEventsForUser(localUserId);
            const found = candidates.find((ev: any) => (ev.startTime === rsvp.startTime) && ((ev.eventTitle || ev.title || '') === (rsvp.eventTitle || rsvp.title || '')) );
            if (found) localEventId = Number(found.eventId);
          } catch {}
        }

        const existingRsvps = await db.getRsvpsForUser(localUserId);
        const exists = existingRsvps.find((r: any) => 
          (localEventId ? r.eventId === localEventId : r.eventId === rsvp.eventId) && r.inviteRecipientId === (inviteeLocalId ?? rsvp.inviteRecipientId)
        );

        if (!exists) {
          // Only create an RSVP if we can resolve stable local numeric ids for
          // the invitee and the owner. Creating RSVPs with raw backend ids
          // that don't correspond to local users leads to broken references.
          if (!inviteeLocalId) {
            console.warn('syncFromBackend: skipping RSVP creation — invitee not resolvable locally', rsvp);
            continue;
          }
          if (!ownerLocalId) {
            console.warn('syncFromBackend: skipping RSVP creation — event owner not resolvable locally', rsvp);
            continue;
          }

          await db.createRsvp({
            eventId: localEventId ?? rsvp.eventId,
            eventOwnerId: ownerLocalId,
            inviteRecipientId: inviteeLocalId,
            status: rsvp.status,
          });
          createdRsvps++;
        } else {
          await db.updateRsvp(exists.rsvpId, { status: rsvp.status });
          updatedRsvps++;
        }
      }
      console.log(`syncFromBackend: rsvps created=${createdRsvps} updated=${updatedRsvps}`);
    } else {
      console.warn('syncFromBackend: skipping rsvps because local user id could not be resolved for', userId);
    }

    // Store notifications - clear old ones and add new. Use backend-provided user id when available.
    if (localUserId) {
      // Keep notifications simple: clear and re-add (notifications are ephemeral)
      // But account for notifications that may belong to a different resolved user
      for (const notif of notifications) {
        try {
          let targetUserId = localUserId;
          // prefer explicit numeric userId from backend if available
          if (notif.userId || notif.user_id) {
            const asNum = Number(notif.userId ?? notif.user_id);
            if (!Number.isNaN(asNum)) targetUserId = asNum;
          }
          // Clear existing notifications for that user once (do it lazily per user)
          // We'll track which users we've cleared to avoid repeated clears
          // Use a simple Set for this sync run
        } catch (e) {
          /* ignore per-notif */
        }
      }
      // We'll clear and re-add notifications per user to keep semantics predictable
      const seenCleared = new Set<number>();
      for (const notif of notifications) {
        try {
          let targetUserId = localUserId;
          // prefer explicit numeric userId from backend if available
          if (notif.userId || notif.user_id) {
            const asNum = Number(notif.userId ?? notif.user_id);
            if (!Number.isNaN(asNum)) targetUserId = asNum;
          }
          if (!seenCleared.has(targetUserId)) {
            await db.clearNotificationsForUser(targetUserId);
            seenCleared.add(targetUserId);
          }
          await db.addNotification({ userId: targetUserId, notifMsg: notif.notifMsg, notifType: notif.notifType, timestamp: notif.createdAt });
        } catch (e) { /* ignore per-notif */ }
      }
      console.log('syncFromBackend: notifications processed count=', notifications.length);
    } else {
      console.warn('syncFromBackend: skipping notifications because local user id could not be resolved for', userId);
    }

    // Store preferences (apply to resolved local user id)
    if (preferences) {
      if (localUserId) {
        await db.setUserPreferences(localUserId, {
          theme: preferences.theme,
          notificationEnabled: preferences.notificationEnabled,
          colorScheme: preferences.colorScheme,
        });
      } else {
        console.warn('syncFromBackend: skipping preferences because local user id could not be resolved for', userId);
      }
    }

    // Run a destructive auto-merge of duplicates after sync to consolidate rows.
    // Disable Firebase sync while performing local destructive changes to avoid
    // reintroducing duplicates via backend writes.
    try {
      FirebaseSync.setFirebaseSyncEnabled(false);
      const dedupeResult = await db.runDuplicateCleanup({ dryRun: false, autoMerge: true });
      console.log('syncFromBackend: duplicate cleanup results:', dedupeResult);
    } catch (e) {
      console.error('syncFromBackend: duplicate cleanup failed:', e);
    } finally {
      // Re-enable Firebase sync so normal operations resume
      FirebaseSync.setFirebaseSyncEnabled(true);
    }

    console.log('Sync completed successfully');
  } catch (error) {
    console.error('Sync failed:', error);
    throw error;
  }
}

/**
 * Start automatic sync every 5 minutes
 */
export function startAutoSync(userId: string | number) {
  if (syncTimer) {
    console.log('Auto-sync already running');
    return;
  }

  console.log('Starting auto-sync...');

  // Resolve numeric user id if a string was provided (e.g. legacy value)
  const start = async () => {
    let userIdNum = Number(userId);
    if (!Number.isFinite(userIdNum) || Number.isNaN(userIdNum)) {
      try {
        const resolved = await db.resolveLocalUserId();
        if (resolved != null) userIdNum = resolved;
      } catch (e) { /* ignore */ }
    }

    if (!Number.isFinite(userIdNum) || Number.isNaN(userIdNum)) {
      console.warn('startAutoSync: could not resolve numeric user id for', userId);
      return;
    }

    // Do initial sync
    syncFromBackend(userIdNum).catch(console.error);

    // Then repeat every 5 minutes
    syncTimer = setInterval(() => {
      syncFromBackend(userIdNum).catch(console.error);
    }, SYNC_INTERVAL);
  };

  // Start the async resolver
  start();
}

/**
 * Stop automatic sync
 */
export function stopAutoSync() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    console.log('Auto-sync stopped');
  }
}

/**
 * Change sync interval (in milliseconds)
 */
export function setSyncInterval(intervalMs: number) {
  if (syncTimer) {
    stopAutoSync();
    // Restart with new interval would need to be done manually
    console.log(`Sync interval updated to ${intervalMs / 1000}s. Restart auto-sync to apply.`);
  }
}

export default {
  setAuthToken,
  syncFromBackend,
  startAutoSync,
  stopAutoSync,
  setSyncInterval,
};

// Diagnostic helper (non-destructive): fetch backend collections and report
// how many records would be processed vs skipped and why. Useful for
// debugging mapping failures without modifying local DB.
export async function diagnosticReport(): Promise<any> {
  const report: any = { resolvedLocalUserId: null, fetched: {}, users: { total: 0, wouldCreate: 0, wouldUpdate: 0 }, events: {}, friends: { total: 0, wouldCreate: 0, skipped: 0, reasons: [] }, rsvps: { total: 0, wouldCreate: 0, skipped: 0, reasons: [] }, notifications: {}, preferences: {} };
  try {
    const resolved = await db.resolveLocalUserId().catch(() => null);
    report.resolvedLocalUserId = resolved;

    const [allUsers, events, friends, rsvps, notifications, preferences] = await Promise.all([
      fetchFromBackend(`/api/users`).catch(() => null),
      fetchFromBackend(`/api/events`).catch(() => []),
      fetchFromBackend(`/api/friends`).catch(() => []),
      fetchFromBackend(`/api/rsvps`).catch(() => []),
      fetchFromBackend(`/api/notifications`).catch(() => []),
      fetchFromBackend(`/api/preferences`).catch(() => null),
    ]);

    report.fetched.users = Array.isArray(allUsers) ? allUsers.length : (allUsers ? 1 : 0);
    report.fetched.events = Array.isArray(events) ? events.length : 0;
    report.fetched.friends = Array.isArray(friends) ? friends.length : 0;
    report.fetched.rsvps = Array.isArray(rsvps) ? rsvps.length : 0;
    report.fetched.notifications = Array.isArray(notifications) ? notifications.length : 0;
    report.fetched.preferences = preferences ? 1 : 0;

    // Users: estimate creates/updates
    if (Array.isArray(allUsers)) {
      report.users.total = allUsers.length;
      for (const user of allUsers) {
        let localMatch = null;
        try { if (user.userId || user.id) localMatch = await db.getUserById(Number(user.userId ?? user.id)); } catch {}
        try { if (!localMatch && (user.firebaseUid || user.firebase_uid || user.uid)) localMatch = await db.getUserByFirebaseUid(String(user.firebaseUid ?? user.firebase_uid ?? user.uid)); } catch {}
        try { if (!localMatch && user.email) localMatch = await db.getUserByEmail(user.email); } catch {}
        if (localMatch && localMatch.userId) report.users.wouldUpdate++; else {
          const fid = user.firebaseUid ?? user.firebase_uid ?? user.uid ?? null; const email = user.email ?? null;
          if (fid || email) report.users.wouldCreate++; // conservative
        }
      }
    }

    // Friends: check resolution
    if (Array.isArray(friends)) {
      report.friends.total = friends.length;
      for (const friend of friends) {
        let friendLocalId: number | null = null;
        try { const asNum = Number(friend.friendId); if (Number.isFinite(asNum) && !Number.isNaN(asNum)) { const u = await db.getUserById(asNum); if (u && u.userId) friendLocalId = Number(u.userId); } } catch {}
        const fid = friend.firebaseUid ?? friend.firebase_uid ?? friend.uid ?? null;
        if (!friendLocalId && fid) { const byUid = await db.getUserByFirebaseUid(String(fid)).catch(() => null); if (byUid && byUid.userId) friendLocalId = Number(byUid.userId); }
        if (!friendLocalId && friend.email) { const u = await db.getUserByEmail(String(friend.email)).catch(() => null); if (u && u.userId) friendLocalId = Number(u.userId); }
        if (friendLocalId) report.friends.wouldCreate++; else {
          // would be skipped unless backend provides email/fid
          if (fid || friend.email) report.friends.wouldCreate++; else { report.friends.skipped++; report.friends.reasons.push({ friend, reason: 'unresolvable' }); }
        }
      }
    }

    // RSVPs: check resolution of invitee and owner
    if (Array.isArray(rsvps)) {
      report.rsvps.total = rsvps.length;
      for (const r of rsvps) {
        let inviteeLocalId: number | null = null;
        try { const asNum = Number(r.inviteRecipientId); if (Number.isFinite(asNum)) { const u = await db.getUserById(asNum); if (u && u.userId) inviteeLocalId = Number(u.userId); } } catch {}
        const inviteeFid = r.inviteRecipientUid ?? r.invite_recipient_uid ?? r.inviteRecipientFirebaseUid ?? null;
        if (!inviteeLocalId && inviteeFid) { const byUid = await db.getUserByFirebaseUid(String(inviteeFid)).catch(() => null); if (byUid && byUid.userId) inviteeLocalId = Number(byUid.userId); }
        if (!inviteeLocalId && (r.inviteRecipientEmail || r.invite_recipient_email)) { const u = await db.getUserByEmail(String(r.inviteRecipientEmail || r.invite_recipient_email)).catch(() => null); if (u && u.userId) inviteeLocalId = Number(u.userId); }

        let ownerLocalId: number | null = null;
        try { const asNumO = Number(r.eventOwnerId); if (Number.isFinite(asNumO)) { const uo = await db.getUserById(asNumO); if (uo && uo.userId) ownerLocalId = Number(uo.userId); } } catch {}
        const ownerFid = r.eventOwnerUid ?? r.event_owner_uid ?? null;
        if (!ownerLocalId && ownerFid) { const byUid = await db.getUserByFirebaseUid(String(ownerFid)).catch(() => null); if (byUid && byUid.userId) ownerLocalId = Number(byUid.userId); }
        if (!ownerLocalId && (r.eventOwnerEmail || r.event_owner_email)) { const byEmail = await db.getUserByEmail(String(r.eventOwnerEmail || r.event_owner_email)).catch(() => null); if (byEmail && byEmail.userId) ownerLocalId = Number(byEmail.userId); }

        if (!inviteeLocalId || !ownerLocalId) {
          report.rsvps.skipped++;
          const reasonParts: string[] = [];
          if (!inviteeLocalId) reasonParts.push('invitee_unresolvable');
          if (!ownerLocalId) reasonParts.push('owner_unresolvable');
          report.rsvps.reasons.push({ rsvp: r, reason: reasonParts.join(',') });
        } else {
          report.rsvps.wouldCreate++;
        }
      }
    }

    // Preferences: if preferences exist but no local user resolved, note it
    report.preferences.exists = !!preferences;
    if (preferences && !resolved) report.preferences.wouldApply = false;

    return report;
  } catch (e) {
    return { error: String(e) };
  }
}