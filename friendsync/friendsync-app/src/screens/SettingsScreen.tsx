// src/screens/SettingsScreen.tsx

import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, Pressable, ActivityIndicator } from 'react-native';
import Screen from '../components/ScreenTmp';
import { useTheme } from '../lib/ThemeProvider';
import { Calendar } from 'react-native-big-calendar';

// added 
// note: do not import firebase auth here; use AuthProvider/ctx instead
import { useAuth } from "../features/auth/AuthProvider";
import firebase from "../lib/firebase";
import db from '../lib/db';
import { emit, on as onEvent } from '../lib/eventBus';
import storage from '../lib/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as simpleSync from '../lib/sync';
import { signOut as firebaseSignOut } from 'firebase/auth';
import { MaterialIcons } from '@expo/vector-icons';


/* 
IMPORTANT NOTE (from alana): 
React Native Big Calendar always uses real Date objects to anchor its week view,
it wasn’t built specifically for “recurring availability” views.
That means it will always display the date numbers (e.g., “Sun 2”, “Mon 3”, etc.), 
because it’s trying to be a real calendar.
But, the week view always updates to the current week automatically.


*/ 

// Helper: get Sunday of the current week (for fixed weekly view)
const getStartOfWeek = (date: Date) => {
  const start = new Date(date);
  const day = start.getDay(); // 0 = Sunday
  start.setDate(start.getDate() - day);
  start.setHours(0, 0, 0, 0);
  return start;
};

// Helper: add days to a given date
const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

export default function SettingsScreen() {
  const t = useTheme();
  const authCtx = useAuth();

  //Determine start & end of fixed week (Sunday → Saturday)
  const today = new Date();
  const weekStart = getStartOfWeek(today);
  const weekEnd = addDays(weekStart, 6);

  // Dummy recurring "Free Time" availability blocks
  // You can imagine these being saved to backend later
  const dummyAvailability = useMemo(
    () => [
      {
        title: 'Morning Free Time',
        start: new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 1, 9, 0),
        end: new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 1, 12, 0),
      },
      {
        title: 'Evening Free Time',
        start: new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 3, 18, 0),
        end: new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 3, 21, 0),
      },
      {
        title: 'Weekend Free Time',
        start: new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6, 10, 0),
        end: new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6, 14, 0),
      },
    ],
    [weekStart]
  );

  // Style for availability blocks (blue, like HomeScreen)
  const eventCellStyle = {
    backgroundColor: t.color.accent,
  };

  // Default scroll position to start near morning hours
  const scrollOffsetMinutes = 8 * 60; // 8 AM

  // Username edit modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await db.init_db();
        // Resolve local user id (numeric) — avoid relying on firebase UID
        let uid: number | null = null;
        try { uid = await db.resolveLocalUserId(); } catch (_) { uid = null; }

        if (!mounted) return;
        setCurrentUserId(uid);
        if (uid != null) {
          const u = await db.getUserById(uid);
          if (mounted) setEditingName(u?.username ?? '');
          return;
        }

        // Try storage fallback (userName) then Firebase displayName/email
        try {
          const stored = await storage.getItem<string>('userName');
          if (mounted && stored) {
            setEditingName(stored);
            return;
          }
        } catch (e) { /* ignore */ }

        if (mounted) setEditingName(authCtx.user?.displayName ?? authCtx.user?.email ?? '');
      } catch (e) {
        // ignore
      }
    })();

    const handler = (p: any) => {
      if (!p) return;
      if (p.username) setEditingName(p.username);
    };
    const unsubscribe = onEvent('user:updated', handler);

    return () => { mounted = false; try { if (typeof unsubscribe === 'function') unsubscribe(); } catch (e) { /* ignore */ } };
  }, []);

  return (
    <Screen>
      {/* Page Header */}
      <Text
        style={{
          color: t.color.text,
          fontSize: t.font.h1,
          fontWeight: '700',
          marginBottom: t.space.sm,
        }}
      >
        User Settings
      </Text>
      <Text style={{ color: t.color.textMuted, marginTop: t.space.sm, marginBottom: t.space.md }}> 
        Settings will go here. Includes potentially username, password and contact info, theme selection, notification preferences, landing page display options and anything else we think of. 
      </Text>
      <Text style={{ color: t.color.textMuted, marginBottom: t.space.md }}>
        Adjust your account preferences and recurring weekly availability.
      </Text>

      {/* User Settings card */}
      <View style={{ marginTop: 12, marginBottom: 12, backgroundColor: t.color.surface, padding: t.space.md, borderRadius: t.radius.md, ...t.shadow?.sm }}>
        <Text style={{ color: t.color.text, fontSize: t.font.h2, fontWeight: '600', marginBottom: t.space.sm }}>Account</Text>
        <Text style={{ color: t.color.textMuted, marginBottom: t.space.sm }}>Display name: {editingName || authCtx.user?.email}</Text>
        <TouchableOpacity onPress={() => setModalVisible(true)} activeOpacity={0.8} style={{ paddingVertical: 10, paddingHorizontal: 12, backgroundColor: t.color.accent, borderRadius: t.radius.sm, alignSelf: 'flex-start' }}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>Change username</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: 16 }}>
          <View style={{ backgroundColor: t.color.surface, borderRadius: 8, padding: 16 }}>
            <Pressable onPress={() => setModalVisible(false)} accessibilityLabel="Close dialog" style={{ position: 'absolute', right: 8, top: 8, padding: 6 }}>
              <MaterialIcons name="close" size={20} color={t.color.textMuted} />
            </Pressable>
            <Text style={{ fontSize: 18, fontWeight: '700', color: t.color.text, marginBottom: 8 }}>Update username</Text>
            <Text style={{ color: t.color.textMuted, marginBottom: 8 }}>Edit the display name that appears in event lists and profiles.</Text>
            <TextInput value={editingName} onChangeText={setEditingName} placeholder="Username" style={{ backgroundColor: '#fff', padding: 10, borderRadius: 6, marginBottom: 12 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <TouchableOpacity onPress={async () => {
                      // Close modal immediately for better UX, then perform save in background.
                      setModalVisible(false);
                      setSaving(true);
                      try {
                        // If no local user exists, create one and persist the new userId
                        if (currentUserId == null) {
                          const email = authCtx.user?.email || (await storage.getItem('userEmail')) || '';
                          const newId = await db.createUser({ username: editingName, email: email });
                          try { await storage.setItem('userId', newId); } catch (e) { /* ignore */ }
                          setCurrentUserId(newId);
                          try { await storage.setItem('userName', editingName); } catch (e) { /* ignore */ }
                          // notify listeners (TopNav) that user updated/created
                          try { emit('user:updated', { userId: newId, username: editingName }); } catch (_) { /* ignore */ }
                        } else {
                          await db.updateUser(currentUserId, { username: editingName });
                          try { await storage.setItem('userName', editingName); } catch (e) { /* ignore */ }
                          try { emit('user:updated', { userId: currentUserId, username: editingName }); } catch (_) { /* ignore */ }
                        }
                      } catch (e) {
                        // Log save failures for debugging
                        // eslint-disable-next-line no-console
                        console.warn('Settings: failed to save username', e);
                      } finally {
                        setSaving(false);
                      }
                    }} style={{ paddingVertical: 8, paddingHorizontal: 12, backgroundColor: t.color.accent, borderRadius: t.radius.sm }}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '600' }}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Subsection Title */}
      <Text
        style={{
          color: t.color.text,
          fontSize: t.font.h2,
          fontWeight: '600',
          marginBottom: t.space.sm,
        }}
      >
        Weekly Availability
      </Text>

      <Text style={{ color: t.color.textMuted, marginBottom: t.space.md }}>
        This calendar reflects your recurring free time for a typical week.
        Future updates will let you edit and save it to your profile.
      </Text>

      {/* Edit Availability Button (non-functional*** placeholder) */}
      <TouchableOpacity
        onPress={() => console.log('Edit availability pressed')}
        activeOpacity={0.7}
      >
        <Text style = {{color: t.color.text}}>Edit Availability</Text>
      </TouchableOpacity>

      {/* Calendar Component */}
      <View style={{ height: 550 }}>
        <Calendar
          events={dummyAvailability} // show free time blocks
          date={weekStart} // fixed week (Sunday–Saturday)
          height={500}
          mode="week"
          scrollOffsetMinutes={scrollOffsetMinutes}
          eventCellStyle={eventCellStyle}
          swipeEnabled={false} // no week navigation
          showTime={true}
          headerContainerStyle={{
            backgroundColor: 'transparent',
          }}
          hourStyle={{ color: t.color.textMuted }}
        />
      </View>
      {/* --- Sign Out Section --- */}
      <View style={{ marginTop: 32, alignItems: "center" }}>
        <Text style={{ color: t.color.textMuted, marginBottom: 8 }}>Signed in as {editingName || authCtx.user?.email}</Text>

        <TouchableOpacity
          onPress={async () => {
            try {
              try { simpleSync.stopAutoSync(); } catch (_) { }
              // Resolve firebase module
              let fb: any = firebase;
              if (!fb || !fb.auth) {
                try { const mod = await import('../lib/firebase'); fb = (mod as any).default || mod; } catch (_) { fb = null; }
              }
              if (fb && fb.auth) {
                try { await firebaseSignOut(fb.auth as any); } catch (e) { try { if (typeof fb.auth.signOut === 'function') await fb.auth.signOut(); } catch (_) { console.warn('Settings: signOut failed', e); } }
              }
              try { await AsyncStorage.multiRemove(['authToken','userId','userEmail','userName']); } catch (_) { }
              try { await storage.removeItem('authToken'); await storage.removeItem('userId'); await storage.removeItem('userEmail'); await storage.removeItem('userName'); } catch (_) { }
              try { emit('auth:signedout'); } catch (_) { }
              console.log("[Auth] User signed out");
            } catch (e) { console.warn('Settings: signOut error', e); }
          }}
          activeOpacity={0.8}
          style={{
            backgroundColor: '#d9534f',
            paddingVertical: 10,
            paddingHorizontal: 20,
            borderRadius: t.radius.md,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </Screen>
  );
}
