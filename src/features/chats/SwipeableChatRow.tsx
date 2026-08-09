import { memo, useCallback } from 'react';
import { Pressable, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { Icon, type IconName } from '@/components/Icon';
import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, spacing } from '@/theme/tokens';
import { ChatRow } from './ChatRow';
import type { ChatSummary } from './useWorkspaces';

/**
 * A chat row with trailing swipe actions.
 *
 * `ChatRow` stays presentational — it does not know it can be swiped, which is
 * what lets it keep being used wherever a row is drawn without one.
 *
 * TRAILING ONLY, and that is the actual constraint rather than the one the code
 * used to state. This screen previously argued against swipe actions because
 * they "would fight the back gesture on the way out of a thread" — but the chats
 * list is a tab root and has no back gesture at all. What is true is narrower: a
 * leading action would begin in the left-edge strip that the interactive pop
 * owns on any screen that IS pushed, so keeping actions on the trailing side
 * means this component stays safe if it is ever reused inside one.
 *
 * Two actions, not more. Past three the panel is wider than the row's text and
 * the swipe stops being a shortcut.
 */
const ACTION_WIDTH = 76;

export const SwipeableChatRow = memo(function SwipeableChatRow({
  summary,
  unread,
  onPress,
  onLongPress,
  onRename,
  onClose,
}: {
  summary: ChatSummary;
  unread: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onRename: () => void;
  onClose: () => void;
}) {
  const renderRightActions = useCallback(
    (_progress: unknown, _translation: unknown, methods: SwipeableMethods) => (
      <View style={{ flexDirection: 'row' }}>
        <SwipeAction
          label="Rename"
          symbol="pencil"
          tone="neutral"
          onPress={() => {
            // Closed before acting, so returning from the rename sheet does not
            // land on a row still hanging open behind it.
            methods.close();
            onRename();
          }}
        />
        <SwipeAction
          label="Close"
          symbol="xmark"
          tone="destructive"
          onPress={() => {
            methods.close();
            onClose();
          }}
        />
      </View>
    ),
    [onRename, onClose]
  );

  return (
    <ReanimatedSwipeable
      friction={2}
      // Both actions have to be reachable before the panel snaps open, so the
      // threshold is a fraction of the panel rather than the default half-width
      // of the whole row.
      rightThreshold={ACTION_WIDTH / 2}
      overshootRight={false}
      // The panel opening is the moment the gesture committed. Feeling it here
      // rather than on the action tap is what tells you the swipe worked while
      // your thumb is still covering the row.
      onSwipeableWillOpen={() => haptics.selection()}
      testID={`chat-swipe-${summary.workspaceId}`}
      renderRightActions={renderRightActions}>
      <ChatRow
        summary={summary}
        unread={unread}
        onPress={onPress}
        onLongPress={onLongPress}
      />
    </ReanimatedSwipeable>
  );
});

function SwipeAction({
  label,
  symbol,
  tone,
  onPress,
}: {
  label: string;
  symbol: IconName;
  tone: 'neutral' | 'destructive';
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const background = tone === 'destructive' ? colors.destructive : colors.fillSubtle;
  const foreground = tone === 'destructive' ? colors.onTint : colors.label;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`swipe-action-${label.toLowerCase()}`}
      style={({ pressed }) => ({
        width: ACTION_WIDTH,
        // Stretches to the row's height rather than a fixed one: rows grow with
        // Dynamic Type, and a short action panel would leave a stripe of
        // background under it.
        justifyContent: 'center',
        alignItems: 'center',
        gap: spacing.xxs,
        minHeight: minTouchTarget,
        backgroundColor: background,
        opacity: pressed ? 0.7 : 1,
      })}>
      <Icon name={symbol} size={20} tintColor={foreground} />
      <Text variant="caption2" style={{ color: foreground }}>
        {label}
      </Text>
    </Pressable>
  );
}
