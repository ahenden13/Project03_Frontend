// this script syncs the backend to the frontend db]

import * as db from './db';

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

  try {

    //convert userId to string for api calls
    const userIdParam = String(userId);

    // Fetch all data from backend
    const [users, events, friends, rsvps, notifications, preferences] = await Promise.all([
      fetchFromBackend(`/api/users`).catch(() => null),
      fetchFromBackend(`/api/events/user/${userIdParam}`).catch(() => []),
      fetchFromBackend(`/api/friends/user/${userIdParam}`).catch(() => []),
      fetchFromBackend(`/api/rsvps/user/${userIdParam}`).catch(() => []),
      fetchFromBackend(`/api/notifications/user/${userIdParam}`).catch(() => []),
      fetchFromBackend(`/api/preferences/${userIdParam}`).catch(() => null),
    ]);

if (Array.isArray(allUsers)) {
  for (const user of allUsers) {
    const existing = await db.getUserById(user.userId);
    if (existing) {
      await db.updateUser(user.userId, {
        username: user.username,
        email: user.email,
        phone_number: user.phoneNumber || user.phone_number || null,
      });
    } else {
      await db.createUser({
        username: user.username,
        email: user.email,
        password: undefined,
        phone_number: user.phoneNumber || user.phone_number || null,
      });
    }
  }
  console.log(`✅ Synced ${allUsers.length} users`);
}


    // Store events - clear and re-add all
    const existingEvents = await db.getEventsForUser(userId);
    for (const event of existingEvents) {
      await db.deleteEvent(event.eventId);
    }
    for (const event of events) {
      await db.createEvent({
        userId: event.userId,
        eventTitle: event.eventTitle || event.title,
        description: event.description,
        startTime: event.startTime,
        endTime: event.endTime,
        date: event.date,
        isEvent: event.isEvent ?? 1,
        recurring: event.recurring ?? 0,
      });
    }

    // Store friends
    for (const friend of friends) {
      // Check if friendship already exists
      const existingFriends = await db.getFriendsForUser(userId);
      const exists = existingFriends.find((f: any) => f.friendId === friend.friendId);
      
      if (!exists) {
        await db.sendFriendRequest(userId, friend.friendId);
        if (friend.status === 'accepted') {
          // Accept the request (you'll need the friendRowId)
          const requests = await db.getFriendRequestsForUser(userId);
          const request = requests.find((r: any) => r.friendId === friend.friendId);
          if (request) {
            await db.respondFriendRequest(request.friendRowId, true);
          }
        }
      }
    }

    // Store RSVPs
    for (const rsvp of rsvps) {
      const existingRsvps = await db.getRsvpsForUser(userId);
      const exists = existingRsvps.find((r: any) => 
        r.eventId === rsvp.eventId && r.inviteRecipientId === rsvp.inviteRecipientId
      );
      
      if (!exists) {
        await db.createRsvp({
          eventId: rsvp.eventId,
          eventOwnerId: rsvp.eventOwnerId,
          inviteRecipientId: rsvp.inviteRecipientId,
          status: rsvp.status,
        });
      } else {
        await db.updateRsvp(exists.rsvpId, { status: rsvp.status });
      }
    }

    // Store notifications - clear old ones and add new
    await db.clearNotificationsForUser(userId);
    for (const notif of notifications) {
      await db.addNotification({
        userId: notif.userId,
        notifMsg: notif.notifMsg,
        notifType: notif.notifType,
        timestamp: notif.createdAt,
      });
    }

    // Store preferences
    if (preferences) {
      await db.setUserPreferences(userId, {
        theme: preferences.theme,
        notificationEnabled: preferences.notificationEnabled,
        colorScheme: preferences.colorScheme,
      });
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