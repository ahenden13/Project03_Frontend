import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import Screen from '../components/ScreenTmp';
import { useTheme } from '../lib/ThemeProvider';
import db from '../lib/db';
import FirebaseSync from '../lib/firebaseSync';

export default function DedupeDebugScreen() {
  const t = useTheme();
  const [report, setReport] = useState<any | null>(null);
  const [running, setRunning] = useState(false);

  const runDry = async () => {
    setRunning(true);
    try {
      await db.init_db();
      const r = await db.runDuplicateCleanup({ dryRun: true });
      setReport(r);
    } catch (e) {
      setReport({ error: String(e) });
    } finally {
      setRunning(false);
    }
  };

  const doMerge = async () => {
    Alert.alert('Confirm', 'This will merge duplicate users (destructive). Disable Firebase sync during operation? Recommended.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Merge', onPress: async () => {
        setRunning(true);
        try {
          // disable firebase sync during destructive changes
          FirebaseSync.setFirebaseSyncEnabled(false);
          await db.init_db();
          const r = await db.runDuplicateCleanup({ dryRun: false, autoMerge: true });
          setReport(r);
        } catch (e) {
          setReport({ error: String(e) });
        } finally {
          FirebaseSync.setFirebaseSyncEnabled(true);
          setRunning(false);
        }
      }}
    ]);
  };

  return (
    <Screen>
      <Text style={{ color: t.color.text, fontSize: t.font.h1, fontWeight: '700', marginBottom: 12 }}>Dedupe Debug</Text>
      <Text style={{ color: t.color.textMuted, marginBottom: 12 }}>Run a dry-run report or perform an auto-merge of detected duplicate users. Always backup before merging.</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <TouchableOpacity onPress={runDry} style={{ padding: 10, backgroundColor: t.color.accent, borderRadius: t.radius.sm, marginRight: 8 }}>
          <Text style={{ color: '#fff' }}>{running ? 'Running...' : 'Run dry-run'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={doMerge} style={{ padding: 10, backgroundColor: '#d9534f', borderRadius: t.radius.sm }}>
          <Text style={{ color: '#fff' }}>{running ? 'Working...' : 'Auto-merge duplicates'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ maxHeight: 420, backgroundColor: t.color.surface, padding: 12, borderRadius: 8 }}>
        <Text style={{ color: t.color.textMuted }}>{JSON.stringify(report, null, 2) || 'No report yet'}</Text>
      </ScrollView>
    </Screen>
  );
}
