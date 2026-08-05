import { Alert, Pressable } from 'react-native';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, spacing } from '@/theme/tokens';

/**
 * Stop the agent.
 *
 * This exists because the app could start work and not stop it. New chats
 * default to `bypassPermissions` — the right default for a phone, since
 * approving every tool call over SSH one tap at a time is the opposite of why
 * you would drive an agent from your pocket — which means an agent started here
 * runs tools without asking, and until now the only way to interrupt one was to
 * open a laptop.
 *
 * Two actions, deliberately not two equal buttons. A tap sends Escape, which is
 * Claude's own "stop this turn": the agent stays alive and the conversation
 * survives. A long press offers Ctrl-C, which can exit the process and end the
 * session, so it asks first and says what it costs. Making them look the same
 * would invite the destructive one by accident.
 *
 * It occupies the slot that previously held an empty spacer balancing the back
 * chevron, so the title stays optically centred whether or not it is showing.
 */
export function StopButton({ onStop }: { onStop: (hard: boolean) => void }) {
  const { colors } = useTheme();

  const confirmHard = () => {
    haptics.error();
    Alert.alert(
      'Force quit the agent?',
      'Ctrl-C can exit the agent process and end this session. The conversation stays on the host but the agent stops running.\n\nA tap on Stop interrupts the current turn without this.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Force quit', style: 'destructive', onPress: () => onStop(true) },
      ]
    );
  };

  return (
    <Pressable
      onPress={() => {
        haptics.medium();
        onStop(false);
      }}
      onLongPress={confirmHard}
      accessibilityRole="button"
      accessibilityLabel="Stop the agent"
      accessibilityHint="Interrupts the current turn. Touch and hold to force quit the agent."
      testID="thread-stop"
      hitSlop={spacing.md}
      style={{
        width: minTouchTarget - spacing.md,
        height: minTouchTarget,
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}>
      <Icon
        name="stop.circle"
        size={22}
        tintColor={colors.destructive}
        fallback={
          <Text color="destructive" weight="600">
            ■
          </Text>
        }
      />
    </Pressable>
  );
}
