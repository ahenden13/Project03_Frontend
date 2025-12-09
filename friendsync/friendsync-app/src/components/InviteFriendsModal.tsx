import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../lib/ThemeProvider';
import db from '../lib/db';

type Props = {
  visible: boolean;
  onClose: () => void;
  eventId: number;
  currentUserId: number;
  eventOwnerId?: number | null;
};

export default function InviteFriendsModal({ visible, onClose, eventId, currentUserId, eventOwnerId }: Props) {
  const t = useTheme();
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [friends, setFriends] = useState<Array<any>>([]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!visible) return;
      setLoading(true);
      try {
        await db.init_db();
        // get all friend rows referencing current user and filter accepted
        const rows = await db.getFriendRowsForUser(currentUserId);
        const accepted: any[] = [];
        for (const r of rows || []) {
          try {
            if (r.status !== 'accepted') continue;
            const otherId = Number(r.userId) === Number(currentUserId) ? Number(r.friendId) : Number(r.userId);
            const u = await db.getUserById(otherId);
            accepted.push({ id: otherId, username: u?.username ?? u?.email ?? `user${otherId}`, email: u?.email ?? null, invited: false });
          } catch (e) {
            // ignore individual fetch errors
          }
        }
        if (mounted) setFriends(accepted);
      } catch (e) {
        console.warn('InviteFriendsModal: failed to load friends', e);
        if (mounted) setFriends([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [visible, currentUserId]);

  async function invite(targetId: number, idx: number) {
    try {
      // create pending RSVP for target
      await db.createRsvp({ eventId: eventId, eventOwnerId: eventOwnerId ?? currentUserId, inviteRecipientId: targetId, status: 'pending' });
      setFriends(prev => prev.map((f,i) => i === idx ? { ...f, invited: true } : f));
    } catch (e) {
      console.warn('Invite failed', e);
    }
  }

  const filtered = friends.filter(f => {
    const q = (search || '').trim().toLowerCase();
    if (!q) return true;
    return String(f.username || '').toLowerCase().includes(q) || String(f.email || '').toLowerCase().includes(q);
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#00000066', justifyContent: 'center', alignItems: 'center', padding: 12 }}>
        <View style={{ backgroundColor: t.color.surface, borderRadius: 10, overflow: 'hidden', maxWidth: 520, width: '100%', alignSelf: 'center', position: 'relative' }}>
          <TouchableOpacity onPress={onClose} style={{ position: 'absolute', top: 8, right: 8, padding: 6, zIndex: 10 }} accessibilityLabel="Close invite">
            <MaterialIcons name="close" size={20} color={t.color.textMuted} />
          </TouchableOpacity>

          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: t.color.text }}>Invite Friends</Text>
            <Text style={{ color: t.color.textMuted, marginTop: 6 }}>Select friends to invite to this event.</Text>
          </View>

          <View style={{ padding: 12 }}>
            <TextInput placeholder="Search friends" value={search} onChangeText={setSearch} style={{ backgroundColor: '#fff', padding: 10, borderRadius: 6, marginBottom: 12 }} />

            {loading ? (
              <ActivityIndicator />
            ) : (
              <FlatList
                data={filtered}
                keyExtractor={(it) => String(it.id)}
                style={{ maxHeight: 360 }}
                renderItem={({ item, index }) => (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
                    <View>
                      <Text style={{ color: t.color.text, fontWeight: '700' }}>{item.username}</Text>
                      {!!item.email && <Text style={{ color: t.color.textMuted }}>{item.email}</Text>}
                    </View>
                    <View>
                      <TouchableOpacity onPress={() => invite(item.id, index)} disabled={item.invited} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: item.invited ? '#888' : t.color.accent }}>
                        <Text style={{ color: '#fff', fontWeight: '700' }}>{item.invited ? 'Invited' : 'Invite'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}
