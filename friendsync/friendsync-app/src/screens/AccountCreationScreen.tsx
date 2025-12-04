// src/screens/AuthScreen.tsx
import { Text } from 'react-native';
import Screen from '../components/ScreenTmp';
import { useTheme } from '../lib/ThemeProvider';

export default function AccountCreationScreen() {
  const t = useTheme();
  return (
    <Screen>
      <Text style={{ color: t.color.text, fontSize: t.font.h1, fontWeight: '600' }}>
        Account Creation (placeholder)
      </Text>
    </Screen>
  );
}
