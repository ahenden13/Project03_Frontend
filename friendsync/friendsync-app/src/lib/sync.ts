// this script syncs the backend to the frontend db]

import * as db from './db';
import FirebaseSync from './firebaseSync';

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

/**
 * Make an authenticated request to the backend
 * takes in the endpoint string such as 'rsvps' or 'friends'
 */
async function fetchFromBackend(endpoint: string | number): Promise<any> {
  const response = await fetch(`${API_URL}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  });

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

    //convert userId to string for api calls
    const userIdParam = String(userId);
    // Resolve the provided userId (which may be numeric local id or a Firebase UID string)
    let localUserId: number | null = null;
    try {
      const asNum = Number(userId);
      if (Number.isFinite(asNum) && !Number.isNaN(asNum)) {
        localUserId = asNum;
      } else {
        const byUid = await db.getUserByFirebaseUid(String(userId));
        if (byUid && byUid.userId) localUserId = Number(byUid.userId);
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
    const [allUsers, events, friends, rsvps, notifications, preferences] = await Promise.all([
      fetchFromBackend(`/api/users`).catch(() => null),
      fetchFromBackend(`/api/events/user/${userIdParam}`).catch(() => []),
      fetchFromBackend(`/api/friends/user/${userIdParam}`).catch(() => []),
      fetchFromBackend(`/api/rsvps/user/${userIdParam}`).catch(() => []),
      fetchFromBackend(`/api/notifications/user/${userIdParam}`).catch(() => []),
      fetchFromBackend(`/api/preferences/${userIdParam}`).catch(() => null),
    ]);

  if (Array.isArray(allUsers)) {
  console.log('syncFromBackend: fetched users count=', allUsers.length);
  for (const user of allUsers) {
    // Prefer matching by firebaseUid (if provided), then email, then numeric id
    let localMatch: any = null;
    // backend may use different key names for the firebase uid — support common variants
    const possibleUid = (user.firebaseUid || user.userFirebaseUid || user.uid || user.id || user.user_id || null);
    try {
      if (possibleUid) localMatch = await db.getUserByFirebaseUid(String(possibleUid));
    } catch (e) { /* ignore */ }
    try {
      if (!localMatch && user.email) localMatch = await db.getUserByEmail(user.email);
    } catch (e) { /* ignore */ }
    try {
      if (!localMatch && (user.userId || user.id)) localMatch = await db.getUserById(Number(user.userId ?? user.id));
    } catch (e) { /* ignore */ }

    if (localMatch && localMatch.userId) {
      // Update the local row and ensure firebaseUid is stored
      const updates: any = { username: user.username, email: user.email };
      if (possibleUid) updates.firebaseUid = String(possibleUid);
      await db.updateUser(Number(localMatch.userId), updates);
      console.log(`syncFromBackend: updated local user ${localMatch.userId} (${updates.username})`);
    } else {
      // create new local user and include firebaseUid when available
      const newLocalId = await db.createUser({
        username: user.username,
        email: user.email,
        password: undefined,
        phone_number: user.phoneNumber || user.phone_number || null,
        firebaseUid: possibleUid ? String(possibleUid) : undefined,
      });
      console.log(`syncFromBackend: created local user ${newLocalId} (${user.username})`);
    }
  }
  console.log(`✅ Synced ${allUsers.length} users`);
}


    // Store events — create or update backend events, but DO NOT delete existing local events.
    // Deleting all local events caused locally-created events to disappear when the backend
    // didn't have them yet. Instead, preserve local events and only add missing backend events.
    if (localUserId) {
      console.log('syncFromBackend: processing events for localUserId=', localUserId, ' backend events=', events.length);
      const existingEvents = await db.getEventsForUser(localUserId);
      console.log('syncFromBackend: existing local events count=', existingEvents.length);

      let createdEvents = 0;
      let updatedEvents = 0;
      for (const event of events) {
        // Try to determine if this backend event already exists locally.
        let exists = null as any;
        try {
          const asNumE = Number(event.eventId ?? event.id);
          if (Number.isFinite(asNumE) && !Number.isNaN(asNumE)) {
            exists = existingEvents.find((x: any) => Number(x.eventId) === asNumE);
          }
        } catch {}

        if (!exists) {
          // Best-effort match by title + startTime among this user's events
          try {
            exists = existingEvents.find((ev: any) => (ev.startTime === event.startTime) && ((ev.eventTitle || ev.title || '') === (event.eventTitle || event.title || '')) );
          } catch {}
        }

        if (!exists) {
          // Create event under the resolved local user id — do NOT delete any locals
          await db.createEvent({
            userId: localUserId,
            eventTitle: event.eventTitle || event.title,
            description: event.description,
            startTime: event.startTime,
            endTime: event.endTime,
            date: event.date,
            isEvent: event.isEvent ?? 1,
            recurring: event.recurring ?? 0,
          });
          createdEvents++;
        } else {
          // Optionally update changed fields — keep this conservative to avoid overwriting local edits
          try {
            const toUpdate: any = {};
            if ((event.eventTitle || event.title) && (exists.eventTitle !== (event.eventTitle || event.title))) toUpdate.eventTitle = event.eventTitle || event.title;
            if (event.description !== undefined && exists.description !== event.description) toUpdate.description = event.description;
            if (event.startTime !== undefined && exists.startTime !== event.startTime) toUpdate.startTime = event.startTime;
            if (event.endTime !== undefined && exists.endTime !== event.endTime) toUpdate.endTime = event.endTime;
            if (Object.keys(toUpdate).length > 0) { await db.updateEvent(Number(exists.eventId), toUpdate); updatedEvents++; }
          } catch (e) {
            // ignore update errors
          }
        }
      }
      console.log(`syncFromBackend: events created=${createdEvents} updated=${updatedEvents}`);
    } else {
      console.warn('syncFromBackend: skipping events because local user id could not be resolved for', userId);
    }

    // Store friends — map backend ids to local ids where possible
    if (localUserId) {
      let createdFriends = 0;
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
        // also support variants like friend.friendFirebaseUid or friend.userFirebaseUid
        if (!friendLocalId && (friend.friendFirebaseUid || friend.userFirebaseUid || friend.firebaseUid)) {
          const uidStr = String(friend.friendFirebaseUid || friend.userFirebaseUid || friend.firebaseUid);
          const u = await db.getUserByFirebaseUid(uidStr);
          if (u && u.userId) friendLocalId = Number(u.userId);
        }
        if (!friendLocalId && friend.email) {
          const u = await db.getUserByEmail(String(friend.email));
          if (u && u.userId) friendLocalId = Number(u.userId);
        }

        const existingFriends = await db.getFriendsForUser(localUserId);
        const exists = existingFriends.find((f: any) => f.friendId === (friendLocalId ?? friend.friendId));

        if (!exists) {
          await db.sendFriendRequest(localUserId, friendLocalId ?? friend.friendId);
          createdFriends++;
          if (friend.status === 'accepted') {
            const requests = await db.getFriendRequestsForUser(localUserId);
            const request = requests.find((r: any) => r.friendId === (friendLocalId ?? friend.friendId));
            if (request) {
              await db.respondFriendRequest(request.friendRowId, true);
            }
          }
        }
      }
      console.log('syncFromBackend: friends created=', createdFriends);
    } else {
      console.warn('syncFromBackend: skipping friends because local user id could not be resolved for', userId);
    }

    // Store RSVPs — map backend ids to local ids where possible
    if (localUserId) {
      let createdRsvps = 0; let updatedRsvps = 0;
      for (const rsvp of rsvps) {
        // Map inviteRecipientId to local id
        let inviteeLocalId: number | null = null;
        try {
          const asNum = Number(rsvp.inviteRecipientId);
          if (Number.isFinite(asNum) && !Number.isNaN(asNum)) {
            const u = await db.getUserById(asNum);
            if (u && u.userId) inviteeLocalId = Number(u.userId);
          }
        } catch {}
        // support multiple backend field variants for the invitee's firebase uid
        if (!inviteeLocalId && (rsvp.inviteRecipientFirebaseUid || rsvp.invite_recipient_firebase_uid || rsvp.inviteRecipientUid || rsvp.inviteRecipientUserFirebaseUid)) {
          const uidStr = String(rsvp.inviteRecipientFirebaseUid || rsvp.invite_recipient_firebase_uid || rsvp.inviteRecipientUid || rsvp.inviteRecipientUserFirebaseUid);
          const u = await db.getUserByFirebaseUid(uidStr);
          if (u && u.userId) inviteeLocalId = Number(u.userId);
        }
        if (!inviteeLocalId && (rsvp.inviteRecipientEmail || rsvp.invite_recipient_email)) {
          const u = await db.getUserByEmail(String(rsvp.inviteRecipientEmail || rsvp.invite_recipient_email));
          if (u && u.userId) inviteeLocalId = Number(u.userId);
        }

        // Map event owner id to local id when backend provides owner's firebase uid
        let ownerLocalId: number | null = null;
        try {
          const asNumO = Number(rsvp.eventOwnerId);
          if (Number.isFinite(asNumO) && !Number.isNaN(asNumO)) {
            const uo = await db.getUserById(asNumO);
            if (uo && uo.userId) ownerLocalId = Number(uo.userId);
          }
        } catch {}
        if (!ownerLocalId && (rsvp.eventOwnerFirebaseUid || rsvp.event_owner_firebase_uid || rsvp.eventOwnerUid)) {
          const uidStr = String(rsvp.eventOwnerFirebaseUid || rsvp.event_owner_firebase_uid || rsvp.eventOwnerUid);
          const uo = await db.getUserByFirebaseUid(uidStr);
          if (uo && uo.userId) ownerLocalId = Number(uo.userId);
        }

        // Map eventId: prefer to find a local event with same startTime+title for this local user
        let localEventId: number | null = null;
        try {
          // Try direct id match first
          const asNumE = Number(rsvp.eventId);
          if (Number.isFinite(asNumE) && !Number.isNaN(asNumE)) {
            const ev = (await db.getEventsForUser(localUserId)).find((x: any) => Number(x.eventId) === asNumE);
            if (ev) localEventId = Number(ev.eventId);
          }
        } catch {}
        if (!localEventId) {
          // Best-effort: match by title+startTime among this user's events
          try {
            const candidates = await db.getEventsForUser(localUserId);
            const found = candidates.find((ev: any) => (ev.startTime === rsvp.startTime) && ((ev.eventTitle || ev.title || '') === (rsvp.eventTitle || rsvp.title || '')) );
            if (found) localEventId = Number(found.eventId);
          } catch {}
        }

        const existingRsvps = await db.getRsvpsForUser(localUserId);
        const exists = existingRsvps.find((r: any) => 
          (localEventId ? r.eventId === localEventId : r.eventId === rsvp.eventId) && r.inviteRecipientId === (inviteeLocalId ?? rsvp.inviteRecipientId)
        );

        if (!exists) {
          await db.createRsvp({
            eventId: localEventId ?? rsvp.eventId,
            eventOwnerId: ownerLocalId ?? rsvp.eventOwnerId,
            inviteRecipientId: inviteeLocalId ?? rsvp.inviteRecipientId,
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

    // Store notifications - clear old ones and add new (use local user id when available)
    if (localUserId) {
      // Keep notifications simple: clear and re-add (notifications are ephemeral)
      await db.clearNotificationsForUser(localUserId);
      for (const notif of notifications) {
        await db.addNotification({
          userId: localUserId,
          notifMsg: notif.notifMsg,
          notifType: notif.notifType,
          timestamp: notif.createdAt,
        });
      }
      console.log('syncFromBackend: notifications replaced count=', notifications.length);
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
  //added conversion to number
  // const userIdNum = Number(userId);

  console.log('Starting auto-sync...');
  
  // Do initial sync
  syncFromBackend(userId).catch(console.error);

  // Then repeat every 5 minutes
  syncTimer = setInterval(() => {
    syncFromBackend(userId).catch(console.error);
  }, SYNC_INTERVAL);
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