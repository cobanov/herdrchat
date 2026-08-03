import { Pressable } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Glass } from '@/components/Glass';
import { haptics } from '@/lib/haptics';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

const SIZE = 40;

/**
 * The "back to newest" affordance, shown only once the reader has scrolled away
 * from the end.
 *
 * It exists because auto-scroll is deliberately suppressed while you are reading
 * back through history — without a way to return, that leaves you stranded and
 * scrolling by hand through a transcript that is still growing underneath you.
 *
 * Interactive glass: it is a floating control that reacts to touch, so it gets
 * the same material as the composer it sits above rather than a hand-rolled
 * shadow imitation.
 */
export function JumpToBottom({
  visible,
  unreadBelow,
  onPress,
}: {
  visible: boolean;
  /** New messages arrived while scrolled away — worth a stronger nudge. */
  unreadBelow: boolean;
  onPress: () => void;
}) {
  const { colors, reduceMotion } = useTheme();
  if (!visible) return null;

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(160)}
      exiting={reduceMotion ? undefined : FadeOut.duration(120)}
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        right: spacing.lg,
        bottom: spacing.sm,
      }}>
      <Pressable
        onPress={() => {
          haptics.selection();
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={unreadBelow ? 'New messages. Jump to latest.' : 'Jump to latest'}
        testID="jump-to-bottom"
        // The glass circle is 40pt, but the tappable area is padded out past the
        // 44pt minimum — this control appears exactly when someone is already
        // scrolling, so it must not require precision.
        hitSlop={spacing.sm}>
        <Glass
          variant="regular"
          interactive
          style={{
            width: SIZE,
            height: SIZE,
            borderRadius: radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: unreadBelow ? colors.tint : colors.separator,
          }}>
          <Icon
            name={unreadBelow ? 'arrow.down.circle.fill' : 'chevron.down'}
            size={unreadBelow ? 22 : 15}
            tintColor={colors.tint}
            fallback={<Text color="tint">↓</Text>}
          />
        </Glass>
      </Pressable>
    </Animated.View>
  );
}
