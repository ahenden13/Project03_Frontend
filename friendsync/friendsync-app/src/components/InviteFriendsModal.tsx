// src/components/InviteFriendsModal.tsx
import React, { useState, useEffect } from 'react';
import { View, Modal, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../lib/ThemeProvider';
import db from '../lib/db';

interface InviteFriendsModalProps {
  visible: boolean;
  onClose: () => void;
  eventId: number;
  currentUserId: number;
  eventOwnerId?: number | null;
}

export default function InviteFriendsModal({ 
  visible, 
  onClose, 
  eventId, 
  currentUserId,
  eventOwnerId 
}: InviteFriendsModalProps) {
  const t = useTheme();
  const [friends, setFriends] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [invitedIds, setInvitedIds] = useState<number[]>([]);

  useEffect(() => {
    if (visible && currentUserId) {
      loadFriends();
    }
  }, [visible, currentUserId]);

  async function loadFriends() {
    console.log('=== InviteFriendsModal: loadFriends ===');
    console.log('currentUserId:', currentUserId);
    console.log('eventId:', eventId);
    
    setLoading(true);
    try {
      // Get accepted friends (this now fetches from API!)
      const friendships = await db.getFriendsForUser(currentUserId);
      console.log('Friendships from DB:', friendships);
      
      // Get already invited users for this event
      const existingRsvps = await db.getRsvpsForEvent(eventId);
      console.log('Existing RSVPs:', existingRsvps);
      const alreadyInvitedSet = new Set(
        (existingRsvps || []).map((r: any) => Number(r.inviteRecipientId))
      );
      console.log('Already invited IDs:', Array.from(alreadyInvitedSet));
      
      // Map friendships to friend user objects
      const friendUsers = await Promise.all(
        (friendships || []).map(async (f: any) => {
          try {
            // Get the OTHER user's ID (not your own)
            const friendUserId = Number(f.userId) === Number(currentUserId) 
              ? Number(f.friendId) 
              : Number(f.userId);
            
            console.log('Loading friend user:', friendUserId);
            
            // Don't show if already invited
            if (alreadyInvitedSet.has(friendUserId)) {
              console.log('Friend already invited:', friendUserId);
              return null;
            }
            
            // Load their user data
            const user = await db.getUserById(friendUserId);
            console.log('Loaded user:', user);
            
            return {
              id: friendUserId,
              username: user?.username || user?.email || `User ${friendUserId}`,
              email: user?.email || ''
            };
          } catch (e) {
            console.warn('Failed to load friend:', e);
            return null;
          }
        })
      );
      
      // Filter out nulls and set
      const validFriends = friendUsers.filter(f => f !== null);
      console.log('Valid friends to show:', validFriends);
      setFriends(validFriends);
    } catch (e) {
      console.error('Failed to load friends:', e);
      setFriends([]);
    } finally {
      setLoading(false);
    }
  }

  async function sendInvite(friendId: number) {
    console.log('=== Sending invite ===');
    console.log('eventId:', eventId);
    console.log('friendId (inviteRecipientId):', friendId);
    console.log('eventOwnerId:', eventOwnerId || currentUserId);
    
    try {
      await db.createRsvp({
        eventId: eventId,
        eventOwnerId: eventOwnerId || currentUserId,
        inviteRecipientId: friendId,
        status: 'no-reply' // Important: Use 'no-reply' to match backend
      });
      
      console.log('Invite sent successfully');
      
      // Mark as invited locally
      setInvitedIds(prev => [...prev, friendId]);
      
      // Remove from list
      setFriends(friends.filter(f => f.id !== friendId));
    } catch (e) {
      console.error('Failed to send invite:', e);
      alert('Failed to send invitation. Please try again.');
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: 12 }}>
        <View style={{ backgroundColor: t.color.surface, borderRadius: 10, overflow: 'hidden', maxHeight: '80%', maxWidth: 500, width: '100%', alignSelf: 'center' }}>
          {/* Header */}
          <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: t.color.text }}>Invite Friends</Text>
            <TouchableOpacity onPress={onClose} style={{ padding: 6 }} accessibilityLabel="Close invite modal">
              <MaterialIcons name="close" size={20} color={t.color.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <View style={{ padding: 12 }}>
            {/* Search box */}
            <TextInput
              placeholder="Search friends..."
              value={search}
              onChangeText={setSearch}
              style={{
                backgroundColor: '#fff',
                padding: 10,
                borderRadius: 6,
                marginBottom: 12,
                borderWidth: 1,
                borderColor: '#ddd'
              }}
            />

            {/* Friends list */}
            {loading ? (
              <ActivityIndicator style={{ padding: 20 }} />
            ) : friends.length === 0 ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <Text style={{ color: t.color.textMuted }}>
                  {search ? 'No friends match your search' : 'No friends to invite'}
                </Text>
              </View>
            ) : (
              <FlatList
                data={friends.filter(f => {
                  const q = (search || '').trim().toLowerCase();
                  if (!q) return true;
                  const un = String(f.username || '').toLowerCase();
                  const em = String(f.email || '').toLowerCase();
                  return un.includes(q) || em.includes(q);
                })}
                keyExtractor={(item) => String(item.id)}
                style={{ maxHeight: 400 }}
                renderItem={({ item }) => (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 8,
                      borderBottomWidth: 1,
                      borderBottomColor: '#eee'
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.color.text, fontWeight: '700' }}>
                        {item.username}
                      </Text>
                      {!!item.email && (
                        <Text style={{ color: t.color.textMuted, fontSize: 12 }}>
                          {item.email}
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity
                      onPress={() => sendInvite(item.id)}
                      disabled={invitedIds.includes(item.id)}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 8,
                        backgroundColor: invitedIds.includes(item.id) ? '#888' : t.color.accent
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '700' }}>
                        {invitedIds.includes(item.id) ? 'Invited' : 'Invite'}
                      </Text>
                    </TouchableOpacity>
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