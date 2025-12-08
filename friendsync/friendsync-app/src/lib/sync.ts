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
        // Prefer matching by numeric userId first, then email
        let localMatch: any = null;
        try {
          if (user.userId || user.id) localMatch = await db.getUserById(Number(user.userId ?? user.id));
        } catch (e) { /* ignore */ }
        try {
          if (!localMatch && user.email) localMatch = await db.getUserByEmail(user.email);
        } catch (e) { /* ignore */ }

        if (localMatch && localMatch.userId) {
          // Update the local row (keep identity mapping by numeric id)
          const updates: any = { username: user.username, email: user.email };
          await db.updateUser(Number(localMatch.userId), updates);
          console.log(`syncFromBackend: updated local user ${localMatch.userId} (${updates.username})`);
        } else {
          // create new local user (no firebase UID mapping used)
          const newLocalId = await db.createUser({
            username: user.username,
            email: user.email,
            password: undefined,
            phone_number: user.phoneNumber || user.phone_number || null,
          });
          console.log(`syncFromBackend: created local user ${newLocalId} (${user.username})`);
        }
      }
      console.log(`✅ Synced ${allUsers.length} users`);
    }


    // Store events — create or update backend events, but DO NOT delete existing local events.
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
        // do not rely on firebase UIDs; try email fallback only
        if (!friendLocalId && friend.email) {
          const u = await db.getUserByEmail(String(friend.email));
          if (u && u.userId) friendLocalId = Number(u.userId);
        }
        if (!friendLocalId && friend.email) {
          const u = await db.getUserByEmail(String(friend.email));
          if (u && u.userId) friendLocalId = Number(u.userId);
        }

        // Find any existing friend row that references both users (either direction)
        const accepted = await db.getFriendsForUser(localUserId);
        const incoming = await db.getFriendRequestsForUser(localUserId);
        // also check outgoing requests (where local user is the requester)
        const outgoing = friendLocalId ? await db.getFriendRequestsForUser(friendLocalId).catch(() => []) : [];

        const combined = [...accepted, ...incoming, ...outgoing];
        const exists = combined.find((f: any) => (
          (Number(f.userId) === Number(localUserId) && Number(f.friendId) === Number(friendLocalId ?? friend.friendId)) ||
          (Number(f.userId) === Number(friendLocalId ?? friend.friendId) && Number(f.friendId) === Number(localUserId)) ||
          (f.friendRowId && friend.friendRowId && Number(f.friendRowId) === Number(friend.friendRowId))
        ));

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
        // Map inviteRecipientId to local id
        let inviteeLocalId: number | null = null;
        try {
          const asNum = Number(rsvp.inviteRecipientId);
          if (Number.isFinite(asNum) && !Number.isNaN(asNum)) {
            const u = await db.getUserById(asNum);
            if (u && u.userId) inviteeLocalId = Number(u.userId);
          }
        } catch {}
        // do not rely on firebase UIDs for invitee mapping
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
        // do not rely on firebase UIDs for owner mapping

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