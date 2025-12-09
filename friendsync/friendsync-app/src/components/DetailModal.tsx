import { Modal, View, Text, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../lib/ThemeProvider';

// refer to this for details on props
type Props = {
  visible: boolean;
  title: string;
  body?: string;
  onClose: () => void;
  actions?: React.ReactNode;
};

export default function DetailModal({ visible, title, body, onClose, actions }: Props) {
  const t = useTheme();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: t.space.lg,
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: 520,
            backgroundColor: t.color.surface,
            borderRadius: t.radius.lg,
            padding: t.space.lg,
            borderWidth: 1,
            borderColor: t.color.border,
            position: 'relative',
          }}
        >
          <Pressable onPress={onClose} accessibilityLabel="Close details" style={{ position: 'absolute', top: 8, right: 8, padding: 6, zIndex: 20 }}>
            <MaterialIcons name="close" size={20} color={t.color.textMuted} />
          </Pressable>

          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>{title}</Text>
          {!!body && <Text style={{ color: t.color.text, marginTop: t.space.sm }}>{body}</Text>}
          {/** Optional action buttons rendered below body (e.g., Invite Friends) */}
          {actions ? <View style={{ marginTop: t.space.md }}>{actions}</View> : null}
        </View>
      </View>
    </Modal>
  );
}
