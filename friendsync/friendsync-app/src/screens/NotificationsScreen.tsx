// src/screens/AuthScreen.tsx
import HomeScreen from './HomeScreen';

import { useMemo, useState, useEffect } from 'react';
import { FlatList, Text, ActivityIndicator, View, Button, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import db from '../lib/db';
import Screen from '../components/ScreenTmp';
import { useTheme } from '../lib/ThemeProvider';
import RowItem from '../components/RowItem';
import DetailModal from '../components/DetailModal';

type NoteRow = { id: string; title: string; body?: string; time?: string };

export default function NotificationsScreen() {
  const t = useTheme();
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [friendRequests, setFriendRequests] = useState<any[]>([]);
  const [pendingRsvps, setPendingRsvps] = useState<any[]>([]);
  const [selected, setSelected] = useState<NoteRow | null>(null);

  // Extracted loader so we can refresh after accept/decline actions
  const loadNotifications = async () => {
    console.log('=== NotificationsScreen: loadNotifications START ===');
    setLoading(true);
    try {
      await db.init_db();
      const userIdStr = await AsyncStorage.getItem('userId');
      const uid = userIdStr ? Number(userIdStr) : NaN;
      let resolvedUserId = Number.isFinite(uid) && !Number.isNaN(uid) ? uid : null;
      console.log('Step 1: Resolved userId from AsyncStorage:', resolvedUserId);
      
      if (resolvedUserId == null) {
        const userEmail = await AsyncStorage.getItem('userEmail');
        console.log('Step 2: Trying to resolve by email:', userEmail);
        if (userEmail) {
          const u = await db.getUserByEmail(userEmail);
          console.log('Step 2a: User found by email:', u);
          if (u && u.userId) resolvedUserId = Number(u.userId);
        }
      }
      if (resolvedUserId == null && __DEV__) {
        console.log('Step 3: DEV mode - getting first user');
        const all = await db.getAllUsers();
        console.log('Step 3a: All users:', all);
        if (all && all.length > 0) resolvedUserId = all[0].userId;
      }
      console.log('Final resolved userId:', resolvedUserId);
      setCurrentUserId(resolvedUserId);

      if (resolvedUserId == null) {
        console.log('No userId found - clearing notifications');
        setFriendRequests([]);
        setPendingRsvps([]);
        return;
      }

      console.log('=== Fetching friend requests for user:', resolvedUserId, '===');
      const incoming = await db.getFriendRequestsForUser(resolvedUserId) || [];
      console.log('Raw friend requests from DB:', incoming);
      console.log('Number of friend requests:', incoming.length);
      
      const enrichedFriends = await Promise.all((incoming || []).map(async (r: any, index: number) => {
        console.log(`Processing friend request ${index + 1}:`, r);
        try {
          // Resolve requester preferring numeric local userId, then remote/server id, then provider UID, then email
          let requester: any = null;
          try {
            const asNum = Number(r.userId);
            console.log(`  Attempting to resolve requester by numeric userId: ${asNum}`);
            if (Number.isFinite(asNum) && !Number.isNaN(asNum)) {
              requester = await db.getUserById(asNum);
              console.log('  Requester found by numeric ID:', requester);
            }
          } catch (e) {
            console.log('  Failed to get user by numeric ID:', e);
          }
          
          if (!requester) {
            console.log('  Attempting to resolve by remote ID:', r.userId);
            try { 
              requester = await db.getUserByRemoteId(r.userId);
              console.log('  Requester found by remote ID:', requester);
            } catch (_) { 
              console.log('  Failed to get user by remote ID');
            }
          }
          
          if (!requester) {
            const uid = String(r.user_uid ?? r.userFirebaseUid ?? r.userUid ?? r.userId ?? '');
            console.log('  Attempting to resolve by Firebase UID:', uid);
            try { 
              requester = await db.getUserByFirebaseUid(uid);
              console.log('  Requester found by Firebase UID:', requester);
            } catch (_) { 
              console.log('  Failed to get user by Firebase UID');
            }
          }
          
          if (!requester && r.userEmail) {
            console.log('  Attempting to resolve by email:', r.userEmail);
            try { 
              requester = await db.getUserByEmail(String(r.userEmail));
              console.log('  Requester found by email:', requester);
            } catch (_) { 
              console.log('  Failed to get user by email');
            }
          }
          
          const name = requester ? (requester.username ?? requester.email ?? `user ${requester.userId}`) : (r.userName ?? r.userDisplayName ?? `user ${r.userId}`);
          console.log('  Final requester name:', name);
          return { id: `fr-${r.friendRowId}`, row: r, name };
        } catch (e) { 
          console.log('  Error processing friend request:', e);
          return { id: `fr-${r.friendRowId}`, row: r, name: `user ${r.userId}` }; 
        }
      }));

      console.log('Enriched friend requests:', enrichedFriends);

      console.log('=== Fetching RSVPs for user:', resolvedUserId, '===');
      const allRsvps = await db.getRsvpsForUser(resolvedUserId) || [];
      console.log('All RSVPs from DB:', allRsvps);
      const pending = (allRsvps || []).filter((r: any) => String(r.status) === 'pending');
      console.log('Pending RSVPs:', pending);
      
      const enrichedRsvps = await Promise.all(pending.map(async (r: any) => {
        try {
          let title = `Event ${r.eventId}`;
          if (r.eventOwnerId != null) {
            const evs = await db.getEventsForUser(Number(r.eventOwnerId));
            const ev = (evs || []).find((e: any) => Number(e.eventId) === Number(r.eventId));
            if (ev) title = ev.eventTitle ?? ev.title ?? title;
          }
          // Resolve owner preferring numeric local userId, then remote id, then firebase uid, then email
          let owner: any = null;
          try {
            const asNum = Number(r.eventOwnerId);
            if (Number.isFinite(asNum) && !Number.isNaN(asNum)) owner = await db.getUserById(asNum);
          } catch {}
          if (!owner) {
            try { owner = await db.getUserByRemoteId(r.eventOwnerId); } catch (_) { /* ignore */ }
          }
          if (!owner) {
            try { owner = await db.getUserByFirebaseUid(String(r.eventOwnerUid ?? r.eventOwnerFirebaseUid ?? r.eventOwnerId ?? '')); } catch (_) { /* ignore */ }
          }
          if (!owner && r.eventOwnerEmail) {
            try { owner = await db.getUserByEmail(String(r.eventOwnerEmail)); } catch (_) { /* ignore */ }
          }
          const ownerName = owner ? (owner.username ?? owner.email ?? `user ${owner.userId}`) : undefined;
          return { id: `rsvp-${r.rsvpId}`, row: r, title, ownerName };
        } catch (_) { return { id: `rsvp-${r.rsvpId}`, row: r, title: `Event ${r.eventId}` }; }
      }));

      console.log('Setting friend requests:', enrichedFriends.length);
      console.log('Setting pending RSVPs:', enrichedRsvps.length);
      setFriendRequests(enrichedFriends);
      setPendingRsvps(enrichedRsvps);
      console.log('=== NotificationsScreen: loadNotifications END ===');
    } catch (e) {
      console.warn('NotificationsScreen load failed', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!mounted) return;
      await loadNotifications();
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <Screen>
      <Text style={{ color: t.color.text, fontSize: t.font.h1, fontWeight: '700', marginBottom: t.space.md }}>
        Notifications
      </Text>

      {loading ? (
        <ActivityIndicator />
      ) : (
        <View>
          {/* Friend requests */}
          {friendRequests && friendRequests.length > 0 ? (
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: t.color.text, fontWeight: '700', marginBottom: 6 }}>Friend Requests</Text>
              <FlatList
                data={friendRequests}
                keyExtractor={it => it.id}
                renderItem={({ item }) => (
                  <View style={styles.rowWithActions}>
                    <RowItem title={item.name} subtitle={'Friend request'} onPress={() => setSelected({ id: item.id, title: 'Friend request', body: `${item.name} sent you a friend request.` })} testID={`friend-request-${item.id}`} />
                    <View style={styles.actions}>
                      <Button title="Accept" onPress={async () => {
                        try {
                          console.log('=== ACCEPT BUTTON CLICKED ===');
                          console.log('Full item.row:', item.row);
                          console.log('item.row.friendRowId:', item.row.friendRowId);
                          console.log('item.row.id:', item.row.id);
                          const friendId = item.row.friendRowId || item.row.id;
                          console.log('Using friendId:', friendId);
                          console.log('Type of friendId:', typeof friendId);
                          console.log('==============================');
                          
                          setLoading(true);
                          
                          // Call respondToFriendRequest with accept=true
                          await db.respondToFriendRequest(friendId, true);
                          
                          console.log('Friend request accepted successfully');
                        } catch (e) { 
                          console.error('Accept friend failed:', e);
                          alert('Failed to accept friend request. Please try again.');
                        } finally {
                          // Reload notifications to update the UI
                          await loadNotifications();
                        }
                      }} />
                      <Button title="Decline" onPress={async () => {
                        try {
                          console.log('Declining friend request:', item.row.friendRowId || item.row.id);
                          setLoading(true);
                          
                          // Use the friendRowId or id from the row
                          const friendId = item.row.friendRowId || item.row.id;
                          
                          // Call respondToFriendRequest with accept=false
                          await db.respondToFriendRequest(friendId, false);
                          
                          console.log('Friend request declined successfully');
                        } catch (e) { 
                          console.error('Decline friend failed:', e);
                          alert('Failed to decline friend request. Please try again.');
                        } finally {
                          // Reload notifications to update the UI
                          await loadNotifications();
                        }
                      }} />
                    </View>
                  </View>
                )}
              />
            </View>
          ) : null}

          {/* Pending RSVPs */}
          {pendingRsvps && pendingRsvps.length > 0 ? (
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: t.color.text, fontWeight: '700', marginBottom: 6 }}>Pending RSVPs</Text>
              <FlatList
                data={pendingRsvps}
                keyExtractor={it => it.id}
                renderItem={({ item }) => (
                  <View style={styles.rowWithActions}>
                    <RowItem title={item.title} subtitle={item.ownerName ? `From ${item.ownerName}` : 'Event invite'} onPress={() => setSelected({ id: item.id, title: item.title, body: `Invited by ${item.ownerName ?? 'host'}` })} testID={`rsvp-${item.id}`} />
                    <View style={styles.actions}>
                      <Button title="Accept" onPress={async () => {
                        try {
                          console.log('Accepting RSVP:', item.row.rsvpId);
                          setLoading(true);
                          if (db.updateRsvp) {
                            try { await db.updateRsvp(item.row.rsvpId, 'accepted'); } catch (_) { await db.updateRsvp(item.row.rsvpId, { status: 'accepted' }); }
                          } else if (db.respondRsvp) {
                            await db.respondRsvp(item.row.rsvpId, 'accepted');
                          }
                          console.log('RSVP accepted successfully');
                        } catch (e) { console.warn('accept rsvp failed', e); }
                        await loadNotifications();
                      }} />
                      <Button title="Decline" onPress={async () => {
                        try {
                          console.log('Declining RSVP:', item.row.rsvpId);
                          setLoading(true);
                          if (db.updateRsvp) {
                            try { await db.updateRsvp(item.row.rsvpId, 'declined'); } catch (_) { await db.updateRsvp(item.row.rsvpId, { status: 'declined' }); }
                          } else if (db.respondRsvp) {
                            await db.respondRsvp(item.row.rsvpId, 'declined');
                          }
                          console.log('RSVP declined successfully');
                        } catch (e) { console.warn('decline rsvp failed', e); }
                        await loadNotifications();
                      }} />
                    </View>
                  </View>
                )}
              />
            </View>
          ) : null}

          {(!friendRequests || friendRequests.length === 0) && (!pendingRsvps || pendingRsvps.length === 0) ? (
            <Text style={{ color: t.color.textMuted }}>No notifications</Text>
          ) : null}
        </View>
      )}

      <DetailModal
        visible={!!selected}
        title={selected?.title ?? ''}
        body={selected?.body}
        onClose={() => setSelected(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowWithActions: {
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
});