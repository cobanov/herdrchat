import { View } from 'react-native';

import { Text } from '@/components/Text';
import { displayText, type ChatMessage } from '@/lib/transcript/message';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, size, spacing } from '@/theme/tokens';

/**
 * What a slash command printed ("Set effort level to medium …"), shown as a
 * note in the middle of the thread: it is the terminal's answer to a command,
 * not something either side said.
 */
export function CommandNote({ message }: { message: ChatMessage }) {
  const { colors } = useTheme();
  return (
    <View
      testID="command-note"
      style={{
        alignSelf: 'center',
        marginHorizontal: size.bubbleGutterMin,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radius.sm,
        backgroundColor: colors.fillSubtle,
      }}>
      <Text variant="caption" color="secondary" style={{ textAlign: 'center' }} selectable>
        {displayText(message)}
      </Text>
    </View>
  );
}
