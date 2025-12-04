// src/screens/AuthScreen.tsx
import HomeScreen from './HomeScreen';

import { useMemo, useState } from 'react';
import { FlatList, Text } from 'react-native';
import Screen from '../components/ScreenTmp';
import { useTheme } from '../lib/ThemeProvider';
import RowItem from '../components/RowItem';
import DetailModal from '../components/DetailModal';

type NoteRow = { id: string; title: string; body?: string; time?: string };

export default function NotificationsScreen() {
  const t = useTheme();

  const notes: NoteRow[] = useMemo(
    () => [
      { id: 'n1', title: 'Invite: Study Group', body: 'Bryan invited you. Mon 5–7 PM.', time: '2h' },
      { id: 'n2', title: 'RSVP update',         body: 'Alana accepted Movie Night.',     time: '5h' },
      { id: 'n3', title: 'Friend request',      body: 'Justin sent you a request.',      time: '1d' },
      { id: 'n4', title: 'Reminder',            body: 'Dinner at Campus Cafe 7 PM.',    time: '2d' },
    ],
    []
  );

  const [selected, setSelected] = useState<NoteRow | null>(null);

  return (
    <Screen>
      <Text style={{ color: t.color.text, fontSize: t.font.h1, fontWeight: '700', marginBottom: t.space.md }}>
        Notifications
      </Text>

      <FlatList
        data={notes}
        keyExtractor={(it) => it.id}
        renderItem={({ item }) => (
          <RowItem
            title={item.title}
            subtitle={item.body ? item.body.substring(0, 60) + (item.body.length > 60 ? '…' : '') : undefined}
            rightLabel={item.time}
            onPress={() => setSelected(item)}
            testID={`note-${item.id}`}
          />
        )}
      />

      <DetailModal
        visible={!!selected}
        title={selected?.title ?? ''}
        body={selected?.body}
        onClose={() => setSelected(null)}
      />
    </Screen>
  );
}
