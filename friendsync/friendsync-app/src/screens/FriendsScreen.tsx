// src/screens/FriendsScreen.tsx
import { useEffect, useState } from 'react';
import { FlatList, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import db from '../lib/db';
import Screen from '../components/ScreenTmp';
import { useTheme } from '../lib/ThemeProvider';
import RowItem from '../components/RowItem';
import DetailModal from '../components/DetailModal';
import { View, Modal, TextInput, TouchableOpacity, Button, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

type FriendRow = { id: string; name: string; status?: string; about?: string };

export default function FriendsScreen() {
  const t = useTheme();

  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [selected, setSelected] = useState<FriendRow | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await db.init_db();
        // try AsyncStorage userId first
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
        if (!mounted) return;
        setCurrentUserId(resolvedUserId);

        if (resolvedUserId == null) {
          setFriends([]);
          return;
        }

        // get accepted friend ids and load their user records
        const fids = await db.getFriendsForUser(resolvedUserId);
        const rows: FriendRow[] = [];
        for (const fid of fids || []) {
          try {
            const u = await db.getUserById(fid);
            if (!u) continue;
            rows.push({ id: String(u.userId), name: u.username ?? u.email ?? `user ${u.userId}`, status: undefined, about: u.email ?? undefined });
          } catch (e) {
            // ignore individual fetch failures
          }
        }
        if (mounted) setFriends(rows);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('FriendsScreen: failed to load friends', e);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Add friend modal state
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [search, setSearch] = useState('');
  const [requestedIds, setRequestedIds] = useState<number[]>([]);

  async function openAddModal() {
    setAddModalVisible(true);
    setLoadingCandidates(true);
    try {
      const all = await db.getAllUsers();
      const accepted = currentUserId ? await db.getFriendsForUser(currentUserId) : [];
      const acceptedSet = new Set((accepted || []).map((x: number) => Number(x)));
      // Also exclude the currently signed-in user by email as a safety
      // in case `currentUserId` has not been resolved yet.
      const storedEmail = (await AsyncStorage.getItem('userEmail'))?.toLowerCase() ?? null;
      const filtered = (all || [])
        .filter((u: any) => u.userId !== currentUserId && !acceptedSet.has(u.userId) && (storedEmail == null || String(u.email || '').toLowerCase() !== storedEmail))
        .map((u: any) => ({ id: u.userId, username: u.username ?? u.email ?? `user${u.userId}`, email: u.email }));
      setCandidates(filtered);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('FriendsScreen: failed to load candidates', e);
      setCandidates([]);
    } finally {
      setLoadingCandidates(false);
    }
  }

  async function sendRequest(targetId: number) {
    if (!currentUserId) return;
    try {
      const r = await db.sendFriendRequest(currentUserId, targetId);
      // mark as requested locally to avoid re-sending
      setRequestedIds(prev => Array.from(new Set([...prev, targetId])));
      // optionally remove from candidates list
      setCandidates(cs => cs.filter(c => c.id !== targetId));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('sendRequest failed', e);
    }
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: t.space.md }}>
        <Text style={{ color: t.color.text, fontSize: t.font.h1, fontWeight: '700' }}>Friends</Text>
        <TouchableOpacity onPress={() => { openAddModal(); }} style={{ backgroundColor: t.color.accent, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Add Friend</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={friends}
        keyExtractor={(it) => it.id}
        renderItem={({ item }) => (
          <RowItem
            title={item.name}
            subtitle={item.status}
            onPress={() => setSelected(item)}
            testID={`friend-${item.id}`}
          />
        )}
      />

      <DetailModal
        visible={!!selected}
        title={selected?.name ?? ''}
        body={selected?.about}
        onClose={() => setSelected(null)}
      />

      <Modal visible={addModalVisible} transparent animationType="slide" onRequestClose={() => setAddModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: 12 }}>
          <View style={{ backgroundColor: t.color.surface, borderRadius: 10, overflow: 'hidden', maxHeight: '80%' }}>
            <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: t.color.text }}>Add Friend</Text>
              <TouchableOpacity onPress={() => setAddModalVisible(false)} style={{ padding: 6 }} accessibilityLabel="Close add friend">
                <MaterialIcons name="close" size={20} color={t.color.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={{ padding: 12 }}>
              <TextInput placeholder="Search username or email" value={search} onChangeText={setSearch} style={{ backgroundColor: '#fff', padding: 10, borderRadius: 6, marginBottom: 12 }} />
              {loadingCandidates ? (
                <ActivityIndicator />
              ) : (
                <FlatList
                  data={candidates.filter(c => {
                    const q = (search || '').trim().toLowerCase();
                    if (!q) return true;
                    const un = String(c.username || '').toLowerCase();
                    const em = String(c.email || '').toLowerCase();
                    return un.includes(q) || em.includes(q);
                  })}
                  keyExtractor={(it) => String(it.id)}
                  style={{ maxHeight: 400 }}
                  renderItem={({ item }) => (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
                      <View>
                        <Text style={{ color: t.color.text, fontWeight: '700' }}>{item.username}</Text>
                        {!!item.email && <Text style={{ color: t.color.textMuted }}>{item.email}</Text>}
                      </View>
                      <View>
                        <TouchableOpacity onPress={() => sendRequest(item.id)} disabled={requestedIds.includes(item.id)} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: requestedIds.includes(item.id) ? '#888' : t.color.accent }}>
                          <Text style={{ color: '#fff', fontWeight: '700' }}>{requestedIds.includes(item.id) ? 'Requested' : 'Add'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                />
              )}
              {/* top-right X closes modal; no bottom Close button for consistency */}
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
