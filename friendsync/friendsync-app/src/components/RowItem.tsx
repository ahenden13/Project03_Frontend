import { Pressable, View, Text } from 'react-native';
import { useTheme } from '../lib/ThemeProvider';

type Props = {
  title: string;
  subtitle?: string;
  rightLabel?: string; // optional small trailing text (e.g., time/count)
  onPress: () => void;
  testID?: string;
};

export default function RowItem({ title, subtitle, rightLabel, onPress, testID }: Props) {
  const t = useTheme();

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}${subtitle ? ', ' + subtitle : ''}`}
      onPress={onPress}
      style={({ pressed }) => ({
        width: '100%',
        minHeight: 68,                      // ensure tappable area
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: t.radius.md,
        backgroundColor: t.color.surface,
        borderWidth: 1,
        borderColor: t.color.border,
        opacity: pressed ? 0.85 : 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,                    // vertical gap between rows
      })}
    >
      {/* Left: title + subtitle */}
      <View style={{ flexShrink: 1, paddingRight: 12 }}>
        <Text
          style={{ color: '#fff', fontWeight: '700' }}
          numberOfLines={1}
        >
          {title}
        </Text>
        {!!subtitle && (
          <Text
            style={{ color: t.color.textMuted, marginTop: 2 }}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        )}
      </View>

      {/* Right: small label  */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {!!rightLabel && (
          <Text style={{ color: t.color.textMuted, marginRight: 8 }} numberOfLines={1}>
            {rightLabel}
          </Text>
        )}
        <Text style={{ color: t.color.textMuted }}>{'›'}</Text>
      </View>
    </Pressable>
  );
}
