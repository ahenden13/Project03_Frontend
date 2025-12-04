// src/lib/firebaseSync.ts
// This module handles syncing local database operations to Firebase Firestore

import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  getDocs, 
  query, 
  where,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';

// Import the appropriate Firebase instance based on platform
import { Platform } from 'react-native';

let db: any;

async function getFirestore() {
  if (db) return db;
  
  if (Platform.OS === 'web') {
    const firebaseWeb = await import('./firebase.web');
    db = firebaseWeb.db;
  } else {
    const firebaseNative = await import('./firebase.native');
    db = firebaseNative.db;
  }
  
  return db;
}

// ============================================================================
// USERS
// ============================================================================

export async function syncUserToFirebase(userData: {
  userId: number;
  username: string;
  email: string;
  password?: string;
  phone_number?: string | null;
}): Promise<void> {
  try {
    const firestore = await getFirestore();
    const userRef = doc(firestore, 'users', String(userData.userId));
    
    await setDoc(userRef, {
      userId: userData.userId,
      username: userData.username,
      email: userData.email,
      phoneNumber: userData.phone_number || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    
    console.log(`✅ Synced user ${userData.userId} to Firebase`);
  } catch (error) {
    console.error('❌ Error syncing user to Firebase:', error);
    throw error;
  }
}

export async function updateUserInFirebase(
  userId: number, 
  updates: {
    username?: string;
    email?: string;
    phone_number?: string | null;
  }
): Promise<void> {
  try {
    const firestore = await getFirestore();
    const userRef = doc(firestore, 'users', String(userId));
    
    const firestoreUpdates: any = {
      ...updates,
      updatedAt: serverTimestamp(),
    };
    
    // Rename phone_number to phoneNumber for Firestore
    if (updates.phone_number !== undefined) {
      firestoreUpdates.phoneNumber = updates.phone_number;
      delete firestoreUpdates.phone_number;
    }
    
    await updateDoc(userRef, firestoreUpdates);
    console.log(`✅ Updated user ${userId} in Firebase`);
  } catch (error) {
    console.error('❌ Error updating user in Firebase:', error);
    throw error;
  }
}

export async function deleteUserFromFirebase(userId: number): Promise<void> {
  try {
    const firestore = await getFirestore();
    
    // Delete user document
    await deleteDoc(doc(firestore, 'users', String(userId)));
    
    // Clean up related data
    // Delete user preferences
    const prefsSnapshot = await getDocs(
      query(collection(firestore, 'user_prefs'), where('userId', '==', userId))
    );
    prefsSnapshot.forEach(async (docSnap) => {
      await deleteDoc(docSnap.ref);
    });
    
    // Delete user's events
    const eventsSnapshot = await getDocs(
      query(collection(firestore, 'events'), where('userId', '==', userId))
    );
    eventsSnapshot.forEach(async (docSnap) => {
      await deleteDoc(docSnap.ref);
    });
    
    // Delete friendships
    const friendsSnapshot = await getDocs(
      query(collection(firestore, 'friends'), where('userId', '==', userId))
    );
    friendsSnapshot.forEach(async (docSnap) => {
      await deleteDoc(docSnap.ref);
    });
    
    console.log(`✅ Deleted user ${userId} from Firebase`);
  } catch (error) {
    console.error('❌ Error deleting user from Firebase:', error);
    throw error;
  }
}

// ============================================================================
// EVENTS
// ============================================================================

export async function syncEventToFirebase(eventData: {
  eventId: number;
  userId: number;
  eventTitle?: string | null;
  description?: string | null;
  startTime: string;
  endTime?: string | null;
  date?: string | null;
  isEvent?: number;
  recurring?: number;
}): Promise<void> {
  try {
    const firestore = await getFirestore();
    const eventRef = doc(firestore, 'events', String(eventData.eventId));
    
    await setDoc(eventRef, {
      eventId: eventData.eventId,
      userId: eventData.userId,
      eventTitle: eventData.eventTitle || null,
      description: eventData.description || null,
      startTime: eventData.startTime,
      endTime: eventData.endTime || null,
      date: eventData.date || null,
      isEvent: eventData.isEvent ?? 1,
      recurring: eventData.recurring ?? 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    
    console.log(`✅ Synced event ${eventData.eventId} to Firebase`);
  } catch (error) {
    console.error('❌ Error syncing event to Firebase:', error);
    throw error;
  }
}

export async function updateEventInFirebase(
  eventId: number,
  updates: {
    eventTitle?: string | null;
    description?: string | null;
    startTime?: string;
    endTime?: string | null;
    date?: string | null;
    recurring?: number | null;
    isEvent?: number | null;
  }
): Promise<void> {
  try {
    const firestore = await getFirestore();
    const eventRef = doc(firestore, 'events', String(eventId));
    
    await updateDoc(eventRef, {
      ...updates,
      updatedAt: serverTimestamp(),
    });
    
    console.log(`✅ Updated event ${eventId} in Firebase`);
  } catch (error) {
    console.error('❌ Error updating event in Firebase:', error);
    throw error;
  }
}

export async function deleteEventFromFirebase(eventId: number): Promise<void> {
  try {
    const firestore = await getFirestore();
    
    // Delete the event
    await deleteDoc(doc(firestore, 'events', String(eventId)));
    
    // Delete related RSVPs
    const rsvpsSnapshot = await getDocs(
      query(collection(firestore, 'rsvps'), where('eventId', '==', eventId))
    );
    rsvpsSnapshot.forEach(async (docSnap) => {
      await deleteDoc(docSnap.ref);
    });
    
    console.log(`✅ Deleted event ${eventId} from Firebase`);
  } catch (error) {
    console.error('❌ Error deleting event from Firebase:', error);
    throw error;
  }
}

// ============================================================================
// FRIENDS
// ============================================================================

export async function syncFriendRequestToFirebase(friendData: {
  friendRowId: number;
  userId: number;
  friendId: number;
  status: string;
}): Promise<void> {
  try {
    const firestore = await getFirestore();
    const friendRef = doc(firestore, 'friends', String(friendData.friendRowId));
    
    await setDoc(friendRef, {
      friendRowId: friendData.friendRowId,
      userId: friendData.userId,
      friendId: friendData.friendId,
      status: friendData.status,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    
    console.log(`✅ Synced friend request ${friendData.friendRowId} to Firebase`);
  } catch (error) {
    console.error('❌ Error syncing friend request to Firebase:', error);
    throw error;
  }
}

export async function updateFriendRequestInFirebase(
  friendRowId: number,
  status: string
): Promise<void> {
  try {
    const firestore = await getFirestore();
    const friendRef = doc(firestore, 'friends', String(friendRowId));
    
    await updateDoc(friendRef, {
      status,
      updatedAt: serverTimestamp(),
    });
    
    console.log(`✅ Updated friend request ${friendRowId} in Firebase`);
  } catch (error) {
    console.error('❌ Error updating friend request in Firebase:', error);
    throw error;
  }
}

export async function deleteFriendshipFromFirebase(friendRowId: number): Promise<void> {
  try {
    const firestore = await getFirestore();
    await deleteDoc(doc(firestore, 'friends', String(friendRowId)));
    
    console.log(`✅ Deleted friendship ${friendRowId} from Firebase`);
  } catch (error) {
    console.error('❌ Error deleting friendship from Firebase:', error);
    throw error;
  }
}

// ============================================================================
// RSVPS
// ============================================================================

export async function syncRsvpToFirebase(rsvpData: {
  rsvpId: number;
  eventId: number;
  eventOwnerId: number;
  inviteRecipientId: number;
  status: string;
}): Promise<void> {
  try {
    const firestore = await getFirestore();
    const rsvpRef = doc(firestore, 'rsvps', String(rsvpData.rsvpId));
    
    await setDoc(rsvpRef, {
      rsvpId: rsvpData.rsvpId,
      eventId: rsvpData.eventId,
      eventOwnerId: rsvpData.eventOwnerId,
      inviteRecipientId: rsvpData.inviteRecipientId,
      status: rsvpData.status,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    
    console.log(`✅ Synced RSVP ${rsvpData.rsvpId} to Firebase`);
  } catch (error) {
    console.error('❌ Error syncing RSVP to Firebase:', error);
    throw error;
  }
}

export async function updateRsvpInFirebase(
  rsvpId: number,
  updates: { status?: string }
): Promise<void> {
  try {
    const firestore = await getFirestore();
    const rsvpRef = doc(firestore, 'rsvps', String(rsvpId));
    
    await updateDoc(rsvpRef, {
      ...updates,
      updatedAt: serverTimestamp(),
    });
    
    console.log(`✅ Updated RSVP ${rsvpId} in Firebase`);
  } catch (error) {
    console.error('❌ Error updating RSVP in Firebase:', error);
    throw error;
  }
}

export async function deleteRsvpFromFirebase(rsvpId: number): Promise<void> {
  try {
    const firestore = await getFirestore();
    await deleteDoc(doc(firestore, 'rsvps', String(rsvpId)));
    
    console.log(`✅ Deleted RSVP ${rsvpId} from Firebase`);
  } catch (error) {
    console.error('❌ Error deleting RSVP from Firebase:', error);
    throw error;
  }
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================

export async function syncNotificationToFirebase(notifData: {
  notificationId: number;
  userId: number;
  notifMsg: string;
  notifType?: string | null;
  createdAt?: string;
}): Promise<void> {
  try {
    const firestore = await getFirestore();
    const notifRef = doc(firestore, 'notifications', String(notifData.notificationId));
    
    await setDoc(notifRef, {
      notificationId: notifData.notificationId,
      userId: notifData.userId,
      notifMsg: notifData.notifMsg,
      notifType: notifData.notifType || null,
      createdAt: notifData.createdAt || new Date().toISOString(),
      isRead: false,
    }, { merge: true });
    
    console.log(`✅ Synced notification ${notifData.notificationId} to Firebase`);
  } catch (error) {
    console.error('❌ Error syncing notification to Firebase:', error);
    throw error;
  }
}

export async function clearNotificationsInFirebase(userId: number): Promise<void> {
  try {
    const firestore = await getFirestore();
    const notificationsSnapshot = await getDocs(
      query(collection(firestore, 'notifications'), where('userId', '==', userId))
    );
    
    notificationsSnapshot.forEach(async (docSnap) => {
      await deleteDoc(docSnap.ref);
    });
    
    console.log(`✅ Cleared notifications for user ${userId} in Firebase`);
  } catch (error) {
    console.error('❌ Error clearing notifications in Firebase:', error);
    throw error;
  }
}

// ============================================================================
// USER PREFERENCES
// ============================================================================

export async function syncUserPreferencesToFirebase(
  userId: number,
  prefs: {
    theme?: number;
    notificationEnabled?: number;
    colorScheme?: number;
  }
): Promise<void> {
  try {
    const firestore = await getFirestore();
    const prefsRef = doc(firestore, 'user_prefs', String(userId));
    
    await setDoc(prefsRef, {
      userId,
      theme: prefs.theme ?? 0,
      notificationEnabled: prefs.notificationEnabled ?? 1,
      colorScheme: prefs.colorScheme ?? 0,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    
    console.log(`✅ Synced preferences for user ${userId} to Firebase`);
  } catch (error) {
    console.error('❌ Error syncing preferences to Firebase:', error);
    throw error;
  }
}

// ============================================================================
// CONFIGURATION
// ============================================================================

let firebaseSyncEnabled = true;

export function setFirebaseSyncEnabled(enabled: boolean) {
  firebaseSyncEnabled = enabled;
  console.log(`Firebase sync ${enabled ? 'enabled' : 'disabled'}`);
}

export function isFirebaseSyncEnabled(): boolean {
  return firebaseSyncEnabled;
}

// Export all functions
export default {
  // Users
  syncUserToFirebase,
  updateUserInFirebase,
  deleteUserFromFirebase,
  
  // Events
  syncEventToFirebase,
  updateEventInFirebase,
  deleteEventFromFirebase,
  
  // Friends
  syncFriendRequestToFirebase,
  updateFriendRequestInFirebase,
  deleteFriendshipFromFirebase,
  
  // RSVPs
  syncRsvpToFirebase,
  updateRsvpInFirebase,
  deleteRsvpFromFirebase,
  
  // Notifications
  syncNotificationToFirebase,
  clearNotificationsInFirebase,
  
  // Preferences
  syncUserPreferencesToFirebase,
  
  // Config
  setFirebaseSyncEnabled,
  isFirebaseSyncEnabled,
};