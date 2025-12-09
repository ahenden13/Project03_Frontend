// src/screens/WelcomeScreen.tsx
import React, { useState, useRef, useEffect } from "react";
import { Text, View, Button, ActivityIndicator, Alert, ScrollView, Platform, TouchableOpacity } from "react-native";
import Screen from "../components/ScreenTmp";
import { useTheme } from "../lib/ThemeProvider";
import storageUtils from "../lib/storageUtils";
import seedDummyData from "../lib/seed";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as simpleSync from "../lib/sync";
import db from "../lib/db";

export default function WelcomeScreen() {
  const t = useTheme();
  const [loading, setLoading] = useState(false);
  const [dump, setDump] = useState<string | null>(null);
  const [status, setStatus] = useState<any | null>(null);
  // secretRevealed: toggled when developer performs the secret gesture.
  const [secretRevealed, setSecretRevealed] = useState(false);
  const tapState = useRef<{ count: number; timer: any }>({ count: 0, timer: null });
  const [syncStatus, setSyncStatus] = useState<string>("Checking...");

  useEffect(() => {
    initializeApp();
  }, []);


  const initializeApp = async () => {
    try {
      // Initialize local database
      await db.init_db();
      
      // Check if user is already logged in
      const token = await AsyncStorage.getItem('authToken');
      const userId = await AsyncStorage.getItem('userId');

    if (token && userId && userId !== 'null' && userId !== 'undefined') {
      // User is logged in, ensure sync is running
      try {
        simpleSync.setAuthToken(token);
        // startAutoSync accepts string or number; pass stored userId directly
        simpleSync.startAutoSync(userId);
        console.log('[Welcome] Auto-sync started for resumed session (userId=', userId, ')');
      } catch (e) {
        console.warn('[Welcome] Failed to resume auto-sync', e);
      }
      setSyncStatus("✓ logged in");
      console.log("[Welcome] Sync resumed for existing session");
    } else {
      setSyncStatus("Not logged in");
      console.log("[Welcome] No valid user session found");
    }
  } catch (error) {
    console.error("[Welcome] Failed to initialize:", error);
    setSyncStatus("Initialization failed");
  }
};

  const initDb = async () => {
    setLoading(true);
    setStatus(null);
    try {
      await db.init_db();
      const s = db.getStatus();
      setStatus(s);
    } catch (e: any) {
      setStatus({ error: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  };

  const refreshStatus = async () => {
    setLoading(true);
    try {
      const s = db.getStatus();
      setStatus(s);
    } catch (e: any) {
      setStatus({ error: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  };

  const dumpStorage = async () => {
    setLoading(true);
    try {
      const out = await storageUtils.dumpAll();
      setDump(JSON.stringify(out, null, 2));
    } catch (e: any) {
      setDump(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  const clearStorage = async () => {
    const prompt = 'This will clear all app storage (navigation state, fallback DB, auth). Continue?';
    const confirmed = Platform.OS === 'web' ? window.confirm(prompt) : await new Promise<boolean>(res => {
      Alert.alert('Clear storage', prompt, [
        { text: 'Cancel', style: 'cancel', onPress: () => res(false) },
        { text: 'Clear', style: 'destructive', onPress: () => res(true) }
      ]);
    });
    if (!confirmed) return;
    setLoading(true);
    try {
      await storageUtils.clearAll();
      setDump('cleared');
    } catch (e: any) {
      setDump(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  const showFallback = async () => {
    setLoading(true);
    try {
      const v = await storageUtils.exportKey('fallback_db_v1');
      setDump(JSON.stringify(v, null, 2));
    } catch (e: any) {
      setDump(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  const runSeed = async () => {
    setLoading(true);
    setDump(null);
    try {
      const res = await seedDummyData();
      setDump(JSON.stringify(res, null, 2));
    } catch (e: any) {
      setDump(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  const repairUidUsernames = async () => {
    setLoading(true);
    setDump(null);
    try {
      const count = await db.repairFirebaseUidUsernames();
      setDump(`Repaired ${count} user(s)`);
    } catch (e: any) {
      setDump(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  const runDiagnostic = async () => {
    setLoading(true);
    setDump(null);
    try {
      const r = await (simpleSync as any).diagnosticReport();
      setDump(JSON.stringify(r, null, 2));
    } catch (e: any) {
      setDump(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <TouchableOpacity onPress={() => {
          // secret gesture: tap the title repeatedly to reveal hidden dev UI
          try {
            const st = tapState.current;
            st.count += 1;
            if (!st.timer) {
              st.timer = setTimeout(() => {
                st.count = 0;
                st.timer = null;
              }, 4000);
            }
            // threshold: 7 taps within 4s
            if (st.count >= 7) {
              setSecretRevealed(true);
              if (st.timer) { clearTimeout(st.timer); st.timer = null; }
              st.count = 0;
              // friendly feedback in dev builds
              if (Platform.OS === 'web') {
                // eslint-disable-next-line no-alert
                alert('Developer debug UI revealed');
              } else {
                Alert.alert('Developer', 'Debug UI revealed');
              }
            }
          } catch (e) {
            // swallow
          }
        }}>
          <Text
          style={{
            color: t.color.text,
            fontSize: t.font.h1 * 1.4,
            fontWeight: "600",
            textAlign: "center",
          }}
        >
          Welcome to FriendSync!
        </Text>
        </TouchableOpacity>
        

        {(secretRevealed || (globalThis as any).__DEBUG_UI__) ? (
          <View style={{ marginTop: t.space.lg, width: "80%" }}>
            {loading ? (
              <ActivityIndicator size="small" color={t.color.accent} />
            ) : (
              <Button
                title="Init DB / Check status"
                onPress={initDb}
                color={t.color.accent}
              />
            )}
          </View>
        ) : null}

        {(secretRevealed || (globalThis as any).__DEBUG_UI__) ? (
          <View style={{ marginTop: t.space.md, width: '80%', alignItems: 'stretch' }}>
            <View style={{ marginTop: t.space.sm }}>
              <Button title="Hide debug" onPress={() => { setSecretRevealed(false); setDump(null); setStatus(null); }} color={t.color.accent} />
            </View>
            <View style={{ marginTop: t.space.sm }}>
              <Button title="Repair UID-like usernames" onPress={repairUidUsernames} color={t.color.accent} />
            </View>
            <View style={{ marginTop: t.space.sm }}>
              <View style={{ marginTop: t.space.xs }}>
                <Button title="Refresh status" onPress={refreshStatus} color={t.color.accent} />
              </View>
              <View style={{ marginTop: t.space.xs }}>
                <Button title="Dump storage" onPress={dumpStorage} color={t.color.accent} />
              </View>
              <View style={{ marginTop: t.space.xs }}>
                <Button title="Seed DB (dev)" onPress={runSeed} color={'#27ae60'} />
              </View>
              <View style={{ marginTop: t.space.xs }}>
                <Button title="Rerun seed (dev)" onPress={runSeed} color={'#2ecc71'} />
              </View>
              <View style={{ marginTop: t.space.xs }}>
                <Button title="Show fallback DB" onPress={showFallback} color={t.color.accent} />
              </View>
              <View style={{ marginTop: t.space.xs }}>
                <Button title="Run sync diagnostic" onPress={runDiagnostic} color={'#2980b9'} />
              </View>
              <View style={{ marginTop: t.space.xs }}>
                <Button title="Clear storage" onPress={clearStorage} color={'#c0392b'} />
              </View>
            </View>
          </View>
        ) : null}

        {status && (
          <View style={{ marginTop: t.space.md, alignItems: "center" }}>
            {status.error ? (
              <Text style={{ color: "red" }}>Error: {status.error}</Text>
            ) : (
              <Text style={{ color: t.color.text }}>
                DB backend: {status.backend} — initialized:{" "}
                {String(status.initialized)}
              </Text>
            )}
          </View>
        )}

        {dump && (
          <View style={{ marginTop: t.space.md, width: '90%' }}>
            <Text style={{ color: t.color.textMuted, marginBottom: t.space.sm }}>Storage dump / fallback DB:</Text>
            <ScrollView style={{ maxHeight: 240, backgroundColor: t.color.surfaceAlt, padding: 8, borderRadius: 6 }}>
              <Text selectable style={{ color: t.color.text, fontFamily: 'monospace', fontSize: 12 }}>{dump}</Text>
            </ScrollView>
          </View>
        )}
      </View>
    </Screen>
  );
}
