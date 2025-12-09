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
    setLoading(true);
    try {
      await db.init_db();
      const userIdStr = await AsyncStorage.getItem('userId');
      const uid = userIdStr ? Number(userIdStr) : NaN;
      let resolvedUserId = Number.isFinite(uid) && !Number.isNaN(uid) ? uid : null;
      if (resolvedUserId == null) {
        const userEmail = await AsyncStorage.getItem('userEmail');
        if (userEmail) {
          const u = await db.getUserByEmail(userEmail);
          if (u && u.userId) resolvedUserId = Number(u.userId);
        }
      }
      if (resolvedUserId == null && __DEV__) {
        const all = await db.getAllUsers();
        if (all && all.length > 0) resolvedUserId = all[0].userId;
      }
      setCurrentUserId(resolvedUserId);

      if (resolvedUserId == null) {
        setFriendRequests([]);
        setPendingRsvps([]);
        return;
      }

      const incoming = await db.getFriendRequestsForUser(resolvedUserId) || [];
      const enrichedFriends = await Promise.all((incoming || []).map(async (r: any) => {
        try {
          // Resolve requester preferring numeric local userId, then remote/server id, then provider UID, then email
          let requester: any = null;
          try {
            const asNum = Number(r.userId);
            if (Number.isFinite(asNum) && !Number.isNaN(asNum)) requester = await db.getUserById(asNum);
          } catch {}
          if (!requester) {
            try { requester = await db.getUserByRemoteId(r.userId); } catch (_) { /* ignore */ }
          }
          if (!requester) {
            try { requester = await db.getUserByFirebaseUid(String(r.user_uid ?? r.userFirebaseUid ?? r.userUid ?? r.userId ?? '')); } catch (_) { /* ignore */ }
          }
          if (!requester && r.userEmail) {
            try { requester = await db.getUserByEmail(String(r.userEmail)); } catch (_) { /* ignore */ }
          }
          const name = requester ? (requester.username ?? requester.email ?? `user ${requester.userId}`) : (r.userName ?? r.userDisplayName ?? `user ${r.userId}`);
          return { id: `fr-${r.friendRowId}`, row: r, name };
        } catch (_) { return { id: `fr-${r.friendRowId}`, row: r, name: `user ${r.userId}` }; }
      }));

      const allRsvps = await db.getRsvpsForUser(resolvedUserId) || [];
      const pending = (allRsvps || []).filter((r: any) => String(r.status) === 'pending');
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

      setFriendRequests(enrichedFriends);
      setPendingRsvps(enrichedRsvps);
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
                          setLoading(true);
                          if (db.respondFriendRequest) {
                            // try common API shapes
                            try { await db.respondFriendRequest(item.row.friendRowId, 'accepted'); } catch (_) { await db.respondFriendRequest(item.row.friendRowId, true); }
                          } else if (db.updateFriendStatus) {
                            await db.updateFriendStatus(item.row.friendRowId, 'accepted');
                          }
                        } catch (e) { console.warn('accept friend failed', e); }
                        await loadNotifications();
                      }} />
                      <Button title="Decline" onPress={async () => {
                        try {
                          setLoading(true);
                          if (db.respondFriendRequest) {
                            try { await db.respondFriendRequest(item.row.friendRowId, 'declined'); } catch (_) { await db.respondFriendRequest(item.row.friendRowId, false); }
                          } else if (db.updateFriendStatus) {
                            await db.updateFriendStatus(item.row.friendRowId, 'declined');
                          }
                        } catch (e) { console.warn('decline friend failed', e); }
                        await loadNotifications();
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
                          setLoading(true);
                          if (db.updateRsvp) {
                            try { await db.updateRsvp(item.row.rsvpId, 'accepted'); } catch (_) { await db.updateRsvp(item.row.rsvpId, { status: 'accepted' }); }
                          } else if (db.respondRsvp) {
                            await db.respondRsvp(item.row.rsvpId, 'accepted');
                          }
                        } catch (e) { console.warn('accept rsvp failed', e); }
                        await loadNotifications();
                      }} />
                      <Button title="Decline" onPress={async () => {
                        try {
                          setLoading(true);
                          if (db.updateRsvp) {
                            try { await db.updateRsvp(item.row.rsvpId, 'declined'); } catch (_) { await db.updateRsvp(item.row.rsvpId, { status: 'declined' }); }
                          } else if (db.respondRsvp) {
                            await db.respondRsvp(item.row.rsvpId, 'declined');
                          }
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
