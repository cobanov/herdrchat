import { useSQLiteContext } from 'expo-sqlite';
import { Pressable } from 'react-native';

import { Glass } from '@/components/Glass';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import { saveSetting } from '@/state/saveSetting';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, size } from '@/theme/tokens';

/**
 * Tool calls shown or hidden, from the conversation itself. The same setting
 * as Settings → Conversations, so it holds for every chat: a thread is mostly
 * read as a conversation, and the machinery is wanted only now and then.
 */
export function ToolActivityToggle() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const shown = useSettings((state) => state.showToolActivity);
  return (
    <Glass interactive style={{ borderRadius: radius.full, overflow: 'hidden' }}>
      <Pressable
        onPress={() => {
          haptics.selection();
          saveSetting(db, 'showToolActivity', !shown);
        }}
        accessibilityRole="switch"
        accessibilityLabel="Tool calls"
        accessibilityState={{ checked: shown }}
        testID="thread-tool-toggle"
        style={{ width: minTouchTarget, height: minTouchTarget, alignItems: 'center', justifyContent: 'center' }}>
        <Icon
          name={shown ? 'wrench.and.screwdriver.fill' : 'wrench.and.screwdriver'}
          size={size.headerGlyph}
          tintColor={shown ? colors.tint : colors.label}
          fallback={<Text>⚒</Text>}
        />
      </Pressable>
    </Glass>
  );
}
