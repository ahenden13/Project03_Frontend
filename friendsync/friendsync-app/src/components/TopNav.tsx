import { View, Text, Pressable, Platform, TouchableOpacity } from 'react-native';
import type { StackHeaderProps } from '@react-navigation/stack';
import { useRoute } from '@react-navigation/native';
import { useTheme } from '../lib/ThemeProvider';
import HomeScreen from '../screens/HomeScreen';
import ApiTestScreen from '../screens/ApiTestScreen';
// NEW: imports for auth state and sign-out
import { useAuth } from '../features/auth/AuthProvider';
import firebase from '../lib/firebase';
import db from '../lib/db';
import { useEffect, useState } from 'react';
import storage from '../lib/storage';
import { on as onEvent } from '../lib/eventBus';

export default function TopNav({ navigation }: StackHeaderProps) {
  const t = useTheme();
  const currentRoute = useRoute();
  const { user } = useAuth(); // NEW
  const signedIn = !!user; // NEW
  const [localDisplayName, setLocalDisplayName] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await db.init_db();
        // Resolve local numeric user id (avoid relying on provider-specific IDs)
        let uidToUse: number | null = null;
        try {
          uidToUse = await db.resolveLocalUserId();
        } catch (e) { /* ignore */ }

        if (!mounted) return;
        if (uidToUse != null) {
          const u = await db.getUserById(uidToUse);
          if (mounted && u) {
            setLocalDisplayName(u.username ?? u.userName ?? u.name ?? null);
            return;
          }
        }

        // try storage fallback (userName) before falling back to firebase
        try {
          const stored = await storage.getItem<string>('userName');
          if (mounted && stored) {
            setLocalDisplayName(stored);
            return;
          }
        } catch (e) {
          // ignore
        }

        // final fallback to Firebase user displayName or email
        if (mounted) setLocalDisplayName(user?.displayName ?? user?.email ?? null);
      } catch (e) {
        // ignore
      }
    })();
    const handler = (p: any) => { if (p && p.username) setLocalDisplayName(p.username); };
    const unsubscribe = onEvent('user:updated', handler);
    return () => { mounted = false; try { unsubscribe(); } catch (e) { /* ignore */ } };
  }, [user]);

  const tabs = [
    { label: 'Test', route: 'ApiTest'},
    { label: 'Welcome', route: 'Welcome' },
    { label: 'Home', route: 'Home' },
    { label: 'Calendar', route: 'Calendar' },
    { label: 'Notifications', route: 'Notifications' }, // placeholder
    { label: 'Events', route: 'Events' },
    { label: 'Friends', route: 'Friends' },
    { label: 'Settings', route: 'Settings' }, // placeholder
  ];

  const tabsignedout = [
    { label: 'Sign in', route: 'Auth' }, // placeholder
    { label: 'Create Account', route: 'AccountCreation' },
  ];

  return (
    <View
      style={{
        backgroundColor: t.color.surface,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: t.space.lg,
        paddingVertical: Platform.OS === 'web' ? t.space.md : t.space.sm,
        borderBottomWidth: 1,
        borderColor: t.color.border,
        ...t.shadow.md,
      }}
    >
      <Text style={{ color: t.color.text, fontSize: 22, fontWeight: '700', letterSpacing: 0.5 }}>
        FriendSync
      </Text>

      {/*
        Choose which set of tabs to render based on auth state.
        Replace the `signedIn` assignment with your real auth hook/context, e.g.
        const { user } = useAuth(); const signedIn = !!user;
      */}
      {(() => {
        //const signedIn = true; // TODO: replace with real auth check
        //currently just choose true or false depending on what you want to see/test
        const menu = signedIn ? tabs : tabsignedout;

        return (
          <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: t.space.lg }}>
            {/* NEW: display user's email or name if signed in */}
            {signedIn && (
              <Text style={{ color: t.color.textMuted, fontSize: 12 }}>
                {localDisplayName ?? user?.displayName ?? user?.email}
              </Text>
            )}

            {/* Existing tab links */}
            {menu.map((tab) => {
              const active = currentRoute.name === tab.route;
              return (
                <Pressable
                  key={tab.route}
                  onPress={() => navigation.navigate(tab.route as never)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                >
                  <Text
                    style={{
                      color: active ? '#fff' : t.color.text,
                      fontWeight: active ? '700' : '500',
                      borderBottomWidth: active ? 2 : 0,
                      borderBottomColor: active ? t.color.accent : 'transparent',
                      paddingBottom: 4,
                    }}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}

            {/* jUSTIN: Sign Out button when signed in */}
            {signedIn && (
              <TouchableOpacity
                onPress={() => {
                  try { if (firebase && (firebase as any).auth && typeof (firebase as any).auth.signOut === 'function') { (firebase as any).auth.signOut(); } else console.warn('[TopNav] No firebase.auth available to sign out'); } catch (e) { console.warn('[TopNav] signOut failed', e); }
                  console.log('[Auth] User signed out');
                }}
                activeOpacity={0.7}
                style={{
                  backgroundColor: '#b91c1c',
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>
                  Sign Out
                </Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })()}
    </View>
  );
}
