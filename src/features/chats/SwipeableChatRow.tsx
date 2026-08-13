import { useRecyclingState } from '@shopify/flash-list';
import { memo, useCallback, useRef } from 'react';
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
  onSwiped,
}: {
  summary: ChatSummary;
  unread: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onRename: () => void;
  onClose: () => void;
  /**
   * The gesture was used. Opening the panel is enough — someone who swipes,
   * reads the two actions and swipes back has learned the gesture, and going on
   * hinting at it would be nagging about something they just did.
   */
  onSwiped: () => void;
}) {
  const swipeable = useRef<SwipeableMethods>(null);

  /**
   * Snap the panel shut when this instance is recycled onto a different chat.
   *
   * FlashList reuses mounted components rather than remounting them, and the
   * swipeable keeps its open state internally — so a row left open, scrolled
   * past and recycled would come back open on an unrelated conversation, with
   * Rename and Close already under the reader's thumb.
   *
   * `reset()`, NOT `close()`, and the difference is visible. `close()` calls
   * `animateRow(0)`; `reset()` writes the shared values directly. Recycling is
   * not a gesture ending, it is a component becoming a different row — so an
   * animation there plays over content that has already changed. Closing a chat
   * shifts every row below it up by one, which recycles them all, and with
   * `close()` that showed as a blank gap where a row should be: the row's height
   * was reserved while its content was still animating in from off-screen.
   *
   * The state value is unused; `onReset` firing on a workspace-id change is the
   * whole point, and it is the hook FlashList ships for exactly this.
   */
  useRecyclingState(false, [summary.workspaceId], () => {
    swipeable.current?.reset();
  });

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
      ref={swipeable}
      friction={2}
      // Both actions have to be reachable before the panel snaps open, so the
      // threshold is a fraction of the panel rather than the default half-width
      // of the whole row.
      rightThreshold={ACTION_WIDTH / 2}
      overshootRight={false}
      // The panel opening is the moment the gesture committed. Feeling it here
      // rather than on the action tap is what tells you the swipe worked while
      // your thumb is still covering the row.
      onSwipeableWillOpen={() => {
        haptics.selection();
        onSwiped();
      }}
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
