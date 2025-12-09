// src/screens/EventsScreen.tsx

import { useMemo, useState, useEffect } from 'react';
import { FlatList, Text, View, Modal, TextInput, TouchableOpacity, Button, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import db from '../lib/db';
import Screen from '../components/ScreenTmp';
import InviteFriendsModal from '../components/InviteFriendsModal';
import { useTheme } from '../lib/ThemeProvider';
import RowItem from '../components/RowItem';
import DetailModal from '../components/DetailModal';

// fields for lists
type EventRow = { id: string; title: string; when: string; where?: string; desc?: string; eventIdNum?: number; ownerId?: number; rsvpStatus?: string | null; rsvpId?: number | null };

export default function EventsScreen() {
  const t = useTheme();

  const [events, setEvents] = useState<EventRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [refreshFlag, setRefreshFlag] = useState(0);
  const [viewMode, setViewMode] = useState<'mine' | 'friends'>('mine');

  // create modal fields
  const [ceTitle, setCeTitle] = useState('');
  const [ceStartHour, setCeStartHour] = useState<number>(9);
  const [ceStartMinute, setCeStartMinute] = useState<number>(0);
  const [ceEndHour, setCeEndHour] = useState<number>(10);
  const [ceEndMinute, setCeEndMinute] = useState<number>(0);
  const [ceDescription, setCeDescription] = useState('');
  const [ceCreatedEventId, setCeCreatedEventId] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await db.init_db();

        // Resolve numeric userId from storage
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
          setEvents([]);
          return;
        }

        const todayStart = new Date();
        todayStart.setHours(0,0,0,0);

        // helper to transform raw event objects into EventRow and filter by isEvent & date
        const normalizeAndFilter = (arr: any[]): EventRow[] => (arr || []).filter((e: any) => {
          const isEvent = e.isEvent === 1 || e.isEvent === true || e.isEvent === undefined;
          if (!isEvent) return false;
          if (!e.startTime) return false;
          const s = new Date(e.startTime);
          if (Number.isNaN(s.getTime())) return false;
          return s.getTime() >= todayStart.getTime();
        }).map((e: any) => {
          const s = e.startTime ? new Date(e.startTime) : null;
          const en = e.endTime ? new Date(e.endTime) : null;
          const when = s ? (en ? `${s.toLocaleString([], { month: 'short', day: 'numeric' })} ${s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${en.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : `${s.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`) : '';
          return {
            id: String(e.eventId ?? e.eventId),
            title: e.eventTitle ?? e.title ?? 'Event',
            when,
            where: e.location ?? undefined,
            desc: e.description ?? undefined,
            eventIdNum: e.eventId ?? undefined,
            ownerId: e.userId ?? undefined,
            rsvpStatus: null,
            rsvpId: null,
          } as EventRow;
        });

        if (viewMode === 'mine') {
          const raw = await db.getEventsForUser(resolvedUserId);
          const rows = normalizeAndFilter(raw);
          setEvents(rows);
        } else {
          // friend events: gather accepted friends and aggregate their events
          const friendIds = await db.getFriendsForUser(resolvedUserId);
          const allRows: EventRow[] = [];
          for (const fid of friendIds || []) {
            try {
              const raw = await db.getEventsForUser(fid);
              const rows = normalizeAndFilter(raw);
              // prefix title with friend's username for clarity, but avoid duplicating
              // the friend's name when the event title already includes it (e.g. "Bob: Team Standup").
              const friend = await db.getUserById(fid);
              const friendName = friend && friend.username ? String(friend.username) : '';
              const prefix = friendName ? `${friendName}: ` : '';
              const sanitize = (title: string) => {
                if (!friendName) return title;
                const t = title || '';
                // remove existing leading "<name>[: -]" patterns (case-insensitive)
                const re = new RegExp(`^\\s*${friendName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*[:\-]\s*`, 'i');
                if (re.test(t)) return t.replace(re, '');
                // also avoid double-prefix if already prefixed with our computed prefix
                if (t.toLowerCase().startsWith(prefix.toLowerCase())) return t.slice(prefix.length);
                return t;
              };
              rows.forEach(r => { r.title = prefix ? `${prefix}${sanitize(String(r.title || ''))}` : String(r.title || ''); allRows.push(r); });
            } catch (e) {
              // ignore individual friend failures
            }
          }
          // enrich aggregated rows with RSVP status for current user
          for (let i = 0; i < allRows.length; i++) {
            const r = allRows[i];
            try {
              if (r.eventIdNum) {
                const rsvps = await db.getRsvpsForEvent(r.eventIdNum);
                const mine = (rsvps || []).find((x: any) => x.inviteRecipientId === resolvedUserId);
                if (mine) {
                  r.rsvpStatus = mine.status ?? null;
                  r.rsvpId = mine.rsvpId ?? mine.rsvpId;
                }
              }
            } catch (e) {
              // ignore RSVP fetch errors
            }
          }

          // sort aggregated rows by start time (best-effort using when string fallback)
          allRows.sort((a,b) => {
            try {
              const aDate = new Date(a.when);
              const bDate = new Date(b.when);
              return (aDate.getTime() || 0) - (bDate.getTime() || 0);
            } catch { return 0; }
          });
          setEvents(allRows);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('EventsScreen: failed to load events', err);
      }
    })();
    return () => { mounted = false; };
  }, [refreshFlag, viewMode]);

  // create/save event
  const saveCreateEvent = async () => {
    if (!currentUserId) return;
    try {
      const pad = (n: number) => String(n).padStart(2, '0');
      const date = new Date();
      const dayIso = date.toISOString().slice(0,10);
      const isoStart = `${dayIso}T${pad(ceStartHour)}:${pad(ceStartMinute)}:00`;
      const isoEnd = `${dayIso}T${pad(ceEndHour)}:${pad(ceEndMinute)}:00`;
      if (ceCreatedEventId) {
        await db.updateEvent(ceCreatedEventId, { eventTitle: ceTitle || 'Event', description: ceDescription || undefined, startTime: isoStart, endTime: isoEnd, date: dayIso });
      } else {
        const newId = await db.createEvent({ userId: currentUserId, eventTitle: ceTitle || 'Event', description: ceDescription || undefined, startTime: isoStart, endTime: isoEnd, date: dayIso, isEvent: 1, recurring: 0 });
        // mark created id so Save becomes an update and invite can reference it
        setCeCreatedEventId(newId);
      }
      setCreateVisible(false);
      // reset fields
      setCeTitle(''); setCeDescription(''); setCeStartHour(9); setCeStartMinute(0); setCeEndHour(10); setCeEndMinute(0);
      setCeCreatedEventId(null);
      // refresh list
      setRefreshFlag(f => f + 1);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('EventsScreen: failed to create event', err);
    }
  };

  const [selected, setSelected] = useState<EventRow | null>(null);
  const [rsvpModalVisible, setRsvpModalVisible] = useState(false);
  const [rsvpTarget, setRsvpTarget] = useState<EventRow | null>(null);
  const [selectedBody, setSelectedBody] = useState<string | null>(null);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteEventId, setInviteEventId] = useState<number | null>(null);
  const [inviteEventOwnerId, setInviteEventOwnerId] = useState<number | null>(null);

  // Open details for an event row. For friend events, fetch RSVP list and
  // display a concise list of who else has responded. For own events, show
  // the regular when/where/description body.
  async function openDetails(item: EventRow) {
    try {
      // if this is a friend event (has eventIdNum and we're in friends mode),
      // fetch RSVPs and build a simple list of responders (excluding current user)
      if (viewMode === 'friends' && item.eventIdNum) {
        try {
          const rsvps = await db.getRsvpsForEvent(item.eventIdNum);
          const others = (rsvps || []).filter((r: any) => r.inviteRecipientId !== currentUserId && r.status);
          const lines: string[] = [];
          if (others.length === 0) {
            lines.push('No responses yet');
          } else {
            // fetch usernames for each responder
            for (const r of others) {
              try {
                const u = await db.getUserById(r.inviteRecipientId);
                const name = u && (u.username || u.email) ? (u.username || u.email) : `user ${r.inviteRecipientId}`;
                lines.push(`${name} — ${r.status}`);
              } catch (e) {
                lines.push(`user ${r.inviteRecipientId} — ${r.status}`);
              }
            }
          }
          setSelectedBody(lines.join('\n'));
        } catch (e) {
          // fallback: show existing details if RSVP fetch fails
          setSelectedBody([item.when ? `When: ${item.when}` : '', item.where ? `Where: ${item.where}` : '', item.desc ? `\n${item.desc}` : ''].filter(Boolean).join('\n'));
        }
      } else {
        setSelectedBody([item.when ? `When: ${item.when}` : '', item.where ? `Where: ${item.where}` : '', item.desc ? `\n${item.desc}` : ''].filter(Boolean).join('\n'));
      }
    } catch (e) {
      // ensure we at least set some body
      setSelectedBody(item ? (item.desc ?? '') : null);
    }
    setSelected(item);
  }

  async function openInviteForEvent(eventId?: number, ownerId?: number | null) {
    if (!eventId) return;
    // close the detail modal (selected) so the invite modal isn't covered
    try { setSelected(null); setSelectedBody(null); } catch (_) { /* ignore */ }
    setInviteEventId(eventId);
    setInviteEventOwnerId(ownerId ?? null);
    setInviteModalVisible(true);
  }

  return (
    <Screen>
      <Text style={{ color: t.color.text, fontSize: t.font.h1, fontWeight: '700', marginBottom: t.space.md }}>
        Events
      </Text>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent', borderRadius: 8, overflow: 'hidden' }}>
          <TouchableOpacity onPress={() => setViewMode('mine')} style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: viewMode === 'mine' ? t.color.accent : 'transparent', borderTopLeftRadius: 8, borderBottomLeftRadius: 8 }}>
            <Text style={{ color: viewMode === 'mine' ? '#fff' : t.color.text, fontWeight: viewMode === 'mine' ? '700' : '600' }}>My Events</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setViewMode('friends')} style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: viewMode === 'friends' ? t.color.accent : 'transparent', borderTopRightRadius: 8, borderBottomRightRadius: 8 }}>
            <Text style={{ color: viewMode === 'friends' ? '#fff' : t.color.text, fontWeight: viewMode === 'friends' ? '700' : '600' }}>Friend Events</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => setCreateVisible(true)} style={{ backgroundColor: t.color.accent, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>New Event</Text>
        </TouchableOpacity>
      </View>

      {/* Single-column, vertically scrollable, compact rows */}
      <FlatList
        data={events}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ paddingBottom: t.space.xl }}
        renderItem={({ item }) => (
          viewMode === 'friends' ? (
            <View style={{ width: '100%', marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Pressable onPress={() => openDetails(item)} style={{ flex: 1, marginRight: 8 }}>
                  <View style={{ backgroundColor: t.color.surface, borderRadius: t.radius.md, padding: 12, borderWidth: 1, borderColor: t.color.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={{ color: '#fff', fontWeight: '700' }} numberOfLines={1}>{item.title}</Text>
                      {!!item.where && <Text style={{ color: t.color.textMuted, marginTop: 4 }} numberOfLines={1}>{item.where}</Text>}
                      <Text style={{ color: t.color.textMuted, marginTop: 6 }}>{item.when}</Text>
                    </View>

                    {/* RSVP button inside card */}
                    <TouchableOpacity
                      onPress={(ev) => { ev.stopPropagation?.(); setRsvpTarget(item); setRsvpModalVisible(true); }}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        borderRadius: 8,
                        backgroundColor: item.rsvpStatus === 'accepted' ? '#2ecc71' : (item.rsvpStatus === 'declined' ? '#e74c3c' : t.color.accent),
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '700' }}>{item.rsvpStatus ? (item.rsvpStatus === 'accepted' ? 'Accepted' : (item.rsvpStatus === 'declined' ? 'Declined' : 'RSVP')) : 'RSVP'}</Text>
                    </TouchableOpacity>
                  </View>
                </Pressable>
              </View>
            </View>
          ) : (
            <RowItem
              title={item.title}
              subtitle={item.where}
              rightLabel={item.when}
              onPress={() => openDetails(item)}      // open
              testID={`event-${item.id}`}
            />
          )
        )}
      />

      <DetailModal
        visible={!!selected}
        title={selected?.title ?? ''}
        body={selectedBody ?? [
          selected?.when ? `When: ${selected.when}` : '',
          selected?.where ? `Where: ${selected.where}` : '',
          selected?.desc ? `\n${selected.desc}` : '',
        ].filter(Boolean).join('\n')}
        onClose={() => { setSelected(null); setSelectedBody(null); }}
        actions={(
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <TouchableOpacity onPress={() => openInviteForEvent(selected?.eventIdNum ?? undefined, selected?.ownerId ?? undefined)} style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#3b82f6', borderRadius: 8 }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Invite Friends</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <Modal visible={createVisible} transparent animationType="slide" onRequestClose={() => setCreateVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: 12 }}>
          <View style={{ backgroundColor: t.color.surface, borderRadius: 10, overflow: 'hidden', maxHeight: '90%' }}>
            <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: '#eee', position: 'relative' }}>
              <Pressable onPress={() => setCreateVisible(false)} accessibilityLabel="Close create event" style={{ position: 'absolute', top: 8, right: 8, padding: 6, zIndex: 20 }}>
                <MaterialIcons name="close" size={20} color={t.color.textMuted} />
              </Pressable>
              <Text style={{ fontSize: 18, fontWeight: '700', color: t.color.text }}>Create Event</Text>
            </View>
            <View style={{ padding: 14 }}>
              <Text style={{ color: t.color.text, marginBottom: 6 }}>Title</Text>
              <TextInput value={ceTitle} onChangeText={setCeTitle} placeholder="Title" style={{ backgroundColor: '#fff', padding: 10, borderRadius: 6, marginBottom: 12 }} />

              <Text style={{ color: t.color.text, marginBottom: 6 }}>Description</Text>
              <TextInput value={ceDescription} onChangeText={setCeDescription} placeholder="Description" style={{ backgroundColor: '#fff', padding: 10, borderRadius: 6, marginBottom: 12 }} multiline />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={{ color: t.color.text, marginBottom: 6 }}>Start</Text>
                  <View style={{ backgroundColor: '#222', padding: 8, borderRadius: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <TouchableOpacity onPress={() => setCeStartHour((ceStartHour + 23) % 24)} style={{ padding: 6, backgroundColor: '#333', borderRadius: 4 }}>
                          <Text style={{ color: '#fff' }}>-</Text>
                        </TouchableOpacity>
                        <Text style={{ width: 36, textAlign: 'center', marginHorizontal: 8, color: '#fff' }}>{String(((ceStartHour + 11) % 12) + 1).padStart(2, '0')}</Text>
                        <TouchableOpacity onPress={() => setCeStartHour((ceStartHour + 1) % 24)} style={{ padding: 6, backgroundColor: '#333', borderRadius: 4 }}>
                          <Text style={{ color: '#fff' }}>+</Text>
                        </TouchableOpacity>
                        <Text style={{ marginHorizontal: 8, color: '#fff' }}>:</Text>
                        <TouchableOpacity onPress={() => setCeStartMinute((ceStartMinute + 45) % 60)} style={{ padding: 6, backgroundColor: '#333', borderRadius: 4 }}>
                          <Text style={{ color: '#fff' }}>-</Text>
                        </TouchableOpacity>
                        <Text style={{ width: 36, textAlign: 'center', marginHorizontal: 8, color: '#fff' }}>{String(ceStartMinute).padStart(2, '0')}</Text>
                        <TouchableOpacity onPress={() => setCeStartMinute((ceStartMinute + 15) % 60)} style={{ padding: 6, backgroundColor: '#333', borderRadius: 4 }}>
                          <Text style={{ color: '#fff' }}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.color.text, marginBottom: 6 }}>End</Text>
                  <View style={{ backgroundColor: '#222', padding: 8, borderRadius: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <TouchableOpacity onPress={() => setCeEndHour((ceEndHour + 23) % 24)} style={{ padding: 6, backgroundColor: '#333', borderRadius: 4 }}>
                          <Text style={{ color: '#fff' }}>-</Text>
                        </TouchableOpacity>
                        <Text style={{ width: 36, textAlign: 'center', marginHorizontal: 8, color: '#fff' }}>{String(((ceEndHour + 11) % 12) + 1).padStart(2, '0')}</Text>
                        <TouchableOpacity onPress={() => setCeEndHour((ceEndHour + 1) % 24)} style={{ padding: 6, backgroundColor: '#333', borderRadius: 4 }}>
                          <Text style={{ color: '#fff' }}>+</Text>
                        </TouchableOpacity>
                        <Text style={{ marginHorizontal: 8, color: '#fff' }}>:</Text>
                        <TouchableOpacity onPress={() => setCeEndMinute((ceEndMinute + 45) % 60)} style={{ padding: 6, backgroundColor: '#333', borderRadius: 4 }}>
                          <Text style={{ color: '#fff' }}>-</Text>
                        </TouchableOpacity>
                        <Text style={{ width: 36, textAlign: 'center', marginHorizontal: 8, color: '#fff' }}>{String(ceEndMinute).padStart(2, '0')}</Text>
                        <TouchableOpacity onPress={() => setCeEndMinute((ceEndMinute + 15) % 60)} style={{ padding: 6, backgroundColor: '#333', borderRadius: 4 }}>
                          <Text style={{ color: '#fff' }}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </View>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 }}>
                <View style={{ flexDirection: 'row' }}>
                  <TouchableOpacity onPress={async () => {
                    // create the event if necessary (but keep create modal open) then open invite modal
                    if (!currentUserId) return;
                    try {
                      const pad = (n: number) => String(n).padStart(2, '0');
                      const date = new Date();
                      const dayIso = date.toISOString().slice(0,10);
                      const isoStart = `${dayIso}T${pad(ceStartHour)}:${pad(ceStartMinute)}:00`;
                      const isoEnd = `${dayIso}T${pad(ceEndHour)}:${pad(ceEndMinute)}:00`;
                      let evId = ceCreatedEventId;
                      if (!evId) {
                        evId = await db.createEvent({ userId: currentUserId, eventTitle: ceTitle || 'Event', description: ceDescription || undefined, startTime: isoStart, endTime: isoEnd, date: dayIso, isEvent: 1, recurring: 0 });
                        setCeCreatedEventId(evId);
                      }
                      openInviteForEvent(evId, currentUserId);
                    } catch (e) {
                      console.warn('Failed to create event for invite', e);
                    }
                  }} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: t.color.accent, marginRight: 8 }}>
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Invite Friends</Text>
                  </TouchableOpacity>
                  <Button title="Save" onPress={saveCreateEvent} />
                </View>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <InviteFriendsModal
        visible={inviteModalVisible}
        onClose={() => {
          setInviteModalVisible(false);
          (async () => {
            try {
              // Try to find the event row from current list first
              const eid = inviteEventId ?? undefined;
              if (!eid) return;
              const found = events.find(e => Number(e.eventIdNum) === Number(eid));
              if (found) {
                await openDetails(found);
                return;
              }
              // fallback: fetch from owner events if owner known
              if (inviteEventOwnerId) {
                const raw = await db.getEventsForUser(inviteEventOwnerId);
                const r = (raw || []).find((x: any) => Number(x.eventId) === Number(eid));
                if (r) {
                  const s = r.startTime ? new Date(r.startTime) : null;
                  const en = r.endTime ? new Date(r.endTime) : null;
                  const when = s ? (en ? `${s.toLocaleString([], { month: 'short', day: 'numeric' })} ${s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${en.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : `${s.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`) : '';
                  const row: EventRow = { id: String(r.eventId), title: r.eventTitle ?? 'Event', when, where: r.location ?? undefined, desc: r.description ?? undefined, eventIdNum: r.eventId, ownerId: r.userId };
                  await openDetails(row);
                }
              }
            } catch (e) {
              console.warn('EventsScreen: failed to reopen event details', e);
            }
          })();
        }}
        eventId={inviteEventId ?? 0}
        currentUserId={currentUserId ?? 0}
        eventOwnerId={inviteEventOwnerId}
      />

      {/* RSVP modal for friend events */}
      <Modal visible={rsvpModalVisible} transparent animationType="fade" onRequestClose={() => setRsvpModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#00000066', justifyContent: 'center', alignItems: 'center', padding: 12 }}>
          <View style={{ backgroundColor: t.color.surface, borderRadius: 10, overflow: 'hidden', maxWidth: 420, width: '100%', alignSelf: 'center', position: 'relative' }}>
            {/* Close button (top-right) */}
            <TouchableOpacity onPress={() => setRsvpModalVisible(false)} style={{ position: 'absolute', top: 8, right: 8, padding: 6, zIndex: 10 }} accessibilityLabel="Close RSVP">
              <MaterialIcons name="close" size={20} color={t.color.textMuted} />
            </TouchableOpacity>

            <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: t.color.text }}>RSVP</Text>
              <Text style={{ color: t.color.textMuted, marginTop: 6 }}>{rsvpTarget?.title}</Text>
            </View>
            <View style={{ padding: 16 }}>
              <Text style={{ color: t.color.text, marginBottom: 12 }}>Would you like to accept or decline this invitation?</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <TouchableOpacity onPress={async () => {
                  // handle decline
                  try {
                    if (!currentUserId || !rsvpTarget || !rsvpTarget.eventIdNum) return;
                    if (rsvpTarget.rsvpId) {
                      await db.updateRsvp(rsvpTarget.rsvpId, { status: 'declined' });
                      setEvents(es => es.map(e => e.eventIdNum === rsvpTarget.eventIdNum ? { ...e, rsvpStatus: 'declined' } : e));
                    } else {
                      const rid = await db.createRsvp({ eventId: rsvpTarget.eventIdNum, eventOwnerId: rsvpTarget.ownerId ?? 0, inviteRecipientId: currentUserId, status: 'declined' });
                      setEvents(es => es.map(e => e.eventIdNum === rsvpTarget.eventIdNum ? { ...e, rsvpStatus: 'declined', rsvpId: rid } : e));
                    }
                    setRsvpModalVisible(false);
                  } catch (e) {
                    // eslint-disable-next-line no-console
                    console.warn('RSVP decline failed', e);
                    setRsvpModalVisible(false);
                  }
                }} style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#e74c3c', borderRadius: 8 }}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Decline</Text>
                </TouchableOpacity>
                <View style={{ width: 8 }} />
                <TouchableOpacity onPress={async () => {
                  // handle accept
                  try {
                    if (!currentUserId || !rsvpTarget || !rsvpTarget.eventIdNum) return;
                    if (rsvpTarget.rsvpId) {
                      await db.updateRsvp(rsvpTarget.rsvpId, { status: 'accepted' });
                      setEvents(es => es.map(e => e.eventIdNum === rsvpTarget.eventIdNum ? { ...e, rsvpStatus: 'accepted' } : e));
                    } else {
                      const rid2 = await db.createRsvp({ eventId: rsvpTarget.eventIdNum, eventOwnerId: rsvpTarget.ownerId ?? 0, inviteRecipientId: currentUserId, status: 'accepted' });
                      setEvents(es => es.map(e => e.eventIdNum === rsvpTarget.eventIdNum ? { ...e, rsvpStatus: 'accepted', rsvpId: rid2 } : e));
                    }
                    setRsvpModalVisible(false);
                  } catch (e) {
                    // eslint-disable-next-line no-console
                    console.warn('RSVP accept failed', e);
                    setRsvpModalVisible(false);
                  }
                }} style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#2ecc71', borderRadius: 8 }}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Accept</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
