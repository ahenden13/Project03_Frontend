// src/screens/HomeScreen.tsx

import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView, Button } from 'react-native';
import Screen from '../components/ScreenTmp';
import { useTheme } from '../lib/ThemeProvider';
import { Calendar } from 'react-native-big-calendar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import db from '../lib/db';


// --- Helper: shift date by N days ---
const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

// --- Helper: get Sunday of the week for a given date ---
const getStartOfWeek = (date: Date) => {
  const start = new Date(date);
  const day = start.getDay(); // 0 = Sunday
  start.setDate(start.getDate() - day); // shift back to Sunday
  start.setHours(0, 0, 0, 0); // start of day
  return start;
};

export default function HomeScreen() {
  const t = useTheme();

  // Week offset allows navigation (0 = current week, ±1 = next/previous week)
  const [weekOffset, setWeekOffset] = useState(0);

  // --- Calculate start and end of visible week ---
  const today = new Date();
  const baseWeekStart = getStartOfWeek(today); // Sunday of current week
  const startDate = addDays(baseWeekStart, weekOffset * 7); // adjust by offset
  const endDate = addDays(startDate, 6); // Saturday
  endDate.setHours(23, 59, 59, 999); // include entire day

  // --- Dummy events ---
  const dummyEvents = useMemo(
    () => [
      { title: 'Team Sync (Hosting)', start: new Date(2025, 9, 30, 10, 0), end: new Date(2025, 9, 30, 11, 0), type: 'hosted' },
      { title: "Friends Birthday Dinner", start: new Date(2025, 9, 31, 18, 0), end: new Date(2025, 9, 31, 21, 0), type: 'invited' },
      { title: 'Free Time', start: new Date(2025, 10, 1, 9, 0), end: new Date(2025, 10, 1, 15, 0), type: 'availability' },
      { title: 'Coffee with Alex', start: new Date(2025, 10, 3, 10, 30), end: new Date(2025, 10, 3, 11, 30), type: 'invited' },
      { title: 'Friendsgiving', start: new Date(2025, 10, 5, 13, 0), end: new Date(2025, 10, 5, 14, 0), type: 'hosted' },
      { title: 'Dinner with Family', start: new Date(2025, 10, 6, 19, 0), end: new Date(2025, 10, 6, 21, 0), type: 'invited' },
      { title: 'Free Time', start: new Date(2025, 10, 8, 9, 0), end: new Date(2025, 10, 8, 15, 0), type: 'availability' },
    ],
    []
  );

  // State: events loaded from local DB for the current signed-in user
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [dbEvents, setDbEvents] = useState<any[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await db.init_db();
        const userIdStr = await AsyncStorage.getItem('userId');
        const userEmail = await AsyncStorage.getItem('userEmail');
        const uid = userIdStr ? Number(userIdStr) : NaN;
        let resolvedUserId = Number.isFinite(uid) && !Number.isNaN(uid) ? uid : null;

        // If userId stored is a non-numeric Firebase UID (string), try to locate
        // a mapped local user by email. Otherwise in dev, fall back to first seeded user.
        if (resolvedUserId == null && userEmail) {
          try {
            const u = await db.getUserByEmail(userEmail);
            if (u && u.userId) resolvedUserId = Number(u.userId);
          } catch (e) { /* ignore */ }
        }

        if (resolvedUserId == null && __DEV__) {
          try {
            const all = await db.getAllUsers();
            if (all && all.length > 0) resolvedUserId = all[0].userId;
          } catch (e) { /* ignore */ }
        }

        if (mounted) setCurrentUserId(resolvedUserId);

        if (resolvedUserId != null) {
          // load events and free time
          const myEv = await db.getEventsForUser(resolvedUserId);
          const myFt = await db.getFreeTimeForUser(resolvedUserId);

          // normalize to BigCalendar event shape
          const mappedEvents = (myEv || []).map((e: any) => ({
            title: e.eventTitle ?? e.title ?? e.description ?? 'Event',
            start: e.startTime ? new Date(e.startTime) : (e.date ? new Date(e.date) : new Date()),
            end: e.endTime ? new Date(e.endTime) : (e.startTime ? new Date(e.startTime) : new Date()),
            type: (e.isEvent === 0 || e.isEvent === false) ? 'availability' : 'hosted',
            raw: e,
          }));

          const mappedFree = (myFt || []).map((f: any) => ({
            title: f.eventTitle ?? f.title ?? 'Free Time',
            start: f.startTime ? new Date(f.startTime) : new Date(),
            end: f.endTime ? new Date(f.endTime) : new Date(new Date().getTime() + 60 * 60 * 1000),
            type: 'availability',
            raw: f,
          }));

          if (mounted) setDbEvents([...mappedEvents, ...mappedFree]);
        }
      } catch (err) {
        // swallow silently — fall back to dummy events
        // eslint-disable-next-line no-console
        console.warn('HomeScreen: failed to load DB events', err);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // --- Filter events to only show those in current week ---
  // Prefer DB-loaded events for the signed-in user, otherwise fall back to dummyEvents
  const sourceEvents = (dbEvents && dbEvents.length > 0) ? dbEvents : dummyEvents;
  const visibleEvents = sourceEvents.filter(
    e => e.start >= startDate && e.start <= endDate
  );

  // --- Auto-scroll: find earliest event hour to scroll calendar ---
  const eventHours = visibleEvents.flatMap(e => [e.start.getHours(), e.end.getHours()]);
  const earliestHour = eventHours.length ? Math.min(...eventHours) : 8; // default 8am
  const scrollOffsetMinutes = Math.max((earliestHour - 1) * 60, 0); // scroll offset in minutes

  // --- Event colors ---
  const eventCellStyle = (event: any) => {
    switch (event.type) {
          case 'availability':
        return { backgroundColor: t.color.accent, borderWidth: 1, borderColor: '#1f74e6' }; // use theme accent with thin darker border
      case 'hosted':
        return { backgroundColor: '#FF3B30', borderWidth: 1, borderColor: '#d12a24' }; // red with thin darker border
      case 'invited':
        return { backgroundColor: '#AF52DE', borderWidth: 1, borderColor: '#8b32c6' }; // purple with thin darker border
      default:
        return { backgroundColor: '#ccc', borderWidth: 1, borderColor: '#999' }; // fallback grey with border
    }
  };

  // --- Modal state for event details ---
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  function openEventModal(ev: any) {
    setSelectedEvent(ev);
    setModalVisible(true);
  }

  function closeEventModal() {
    setSelectedEvent(null);
    setModalVisible(false);
  }

  return (
    <Screen>
      {/* --- Screen Header --- */}
      {/* <Text
        style={{
          color: t.color.text,
          fontSize: t.font.h1,
          fontWeight: '700',
          marginBottom: t.space.xs,
        }}
      >
        Welcome to FriendSync
      </Text> */}
      {/* <Text style={{ color: t.color.textMuted, marginBottom: t.space.md }}>
        Sync up!
      </Text> */}

      {/* --- Subtitle --- */}
      <Text
        style={{
          color: t.color.text,
          fontSize: t.font.h2,
          fontWeight: '600',
          marginBottom: t.space.sm,
        }}
      >
        Weekly Calendar
      </Text>

      {/* --- Week Navigation --- */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginBottom: t.space.sm,
        }}
      >
        <TouchableOpacity onPress={() => setWeekOffset(weekOffset - 1)}>
          <Text style={{ color: t.color.text }}>← Previous</Text>
        </TouchableOpacity>
        <Text style={{ color: t.color.textMuted, fontWeight: '500' }}>
          {startDate.toDateString()} – {endDate.toDateString()}
        </Text>
        <TouchableOpacity onPress={() => setWeekOffset(weekOffset + 1)}>
          <Text style={{ color: t.color.text }}>Next →</Text>
        </TouchableOpacity>
      </View>

      {/* --- Color Legend --- */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-around',
          marginBottom: t.space.sm,
          paddingVertical: 4,
        }}
      >
        {/* Availability */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: t.color.accent }} />
          <Text style={{ color: t.color.text }}>Availability</Text>
        </View>
        {/* Hosted Event */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: '#FF3B30' }} />
          <Text style={{ color: t.color.text }}>Hosted Event</Text>
        </View>
        {/* Invited Event */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: '#AF52DE' }} />
          <Text style={{ color: t.color.text }}>Invited Event</Text>
        </View>
      </View>

      {/* --- Calendar Component --- */}
      <View style={{ height: 600 }}>
        <Calendar
          events={visibleEvents} // array of events to show
          date={startDate} // starting date of week
          height={500}
          mode="week" // week view
          scrollOffsetMinutes={scrollOffsetMinutes} // auto-scroll to first event
          eventCellStyle={eventCellStyle} // style function for events
          onPressEvent={(ev: any) => openEventModal(ev)}
          swipeEnabled={false} // disable swipe between weeks
          showTime={true} // show time labels
          headerContainerStyle={{ backgroundColor: 'transparent' }} // remove default header background
          hourStyle={{ color: t.color.textMuted }} // color of hour labels
        />
      </View>

      {/* --- Event Details Modal --- */}
      <Modal visible={modalVisible} animationType="slide" transparent={true} onRequestClose={closeEventModal}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: t.color.surface || '#fff' }]}>
            <ScrollView>
              <Text style={[styles.modalTitle, { color: t.color.text }]}>{selectedEvent?.title ?? 'Event'}</Text>
              <Text style={{ color: t.color.textMuted, marginBottom: 8 }}>
                {selectedEvent ? `${selectedEvent.start.toLocaleString()} — ${selectedEvent.end.toLocaleString()}` : ''}
              </Text>
              <Text style={{ color: t.color.text, marginBottom: 12 }}>{selectedEvent?.raw?.description ?? 'No description'}</Text>

              <Text style={{ color: t.color.textMuted, fontWeight: '600', marginBottom: 6 }}>Type</Text>
              <Text style={{ color: t.color.text, marginBottom: 12 }}>{selectedEvent?.type ?? 'unknown'}</Text>

              {selectedEvent?.raw?.userId != null && (
                <>
                  <Text style={{ color: t.color.textMuted, fontWeight: '600', marginBottom: 6 }}>Owner</Text>
                  <Text style={{ color: t.color.text, marginBottom: 12 }}>{String(selectedEvent.raw.userId)}</Text>
                </>
              )}

              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                <Button title="Close" onPress={closeEventModal} />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 720,
    borderRadius: 12,
    padding: 16,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
});
