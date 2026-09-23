import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { Glass, useGlassAvailable } from '@/components/Glass';
import { haptics } from '@/lib/haptics';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { motion, radius, size, spacing } from '@/theme/tokens';

const PLACEMENT = { position: 'absolute', right: spacing.lg, bottom: spacing.sm } as const;

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
 *
 * Real glass stays mounted and dematerialises when hidden, because fading an
 * ancestor's opacity (the old FadeIn/FadeOut wrapper) switches the effect off
 * for the length of the fade (#111). Blur and solid fallbacks have no such
 * limit and keep the ordinary fade.
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
  const { reduceMotion } = useTheme();
  const glassy = useGlassAvailable();

  if (glassy) {
    return (
      <View pointerEvents={visible ? 'box-none' : 'none'} style={PLACEMENT}>
        <JumpButton shown={visible} unreadBelow={unreadBelow} onPress={onPress} />
      </View>
    );
  }

  if (!visible) return null;
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(motion.fade)}
      exiting={reduceMotion ? undefined : FadeOut.duration(motion.fadeFast)}
      pointerEvents="box-none"
      style={PLACEMENT}>
      <JumpButton shown unreadBelow={unreadBelow} onPress={onPress} />
    </Animated.View>
  );
}

function JumpButton({
  shown,
  unreadBelow,
  onPress,
}: {
  shown: boolean;
  unreadBelow: boolean;
  onPress: () => void;
}) {
  const { colors, reduceMotion } = useTheme();
  // The glyph is a child of the glass, not an ancestor, so opacity is safe here.
  const glyph = useAnimatedStyle(
    () => ({
      opacity: withTiming(shown ? 1 : 0, { duration: reduceMotion ? 0 : motion.fade }),
    }),
    [shown, reduceMotion]
  );

  return (
    <Pressable
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      disabled={!shown}
      accessibilityRole="button"
      accessibilityLabel={unreadBelow ? 'New messages. Jump to latest.' : 'Jump to latest'}
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
      testID="jump-to-bottom"
      // The glass circle is 40pt, but the tappable area is padded out past the
      // 44pt minimum — this control appears exactly when someone is already
      // scrolling, so it must not require precision.
      hitSlop={spacing.sm}>
      <Glass
        variant="regular"
        interactive
        hidden={!shown}
        style={{
          width: size.jumpButton,
          height: size.jumpButton,
          borderRadius: radius.full,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: !shown ? 'transparent' : unreadBelow ? colors.tint : colors.separator,
        }}>
        <Animated.View style={glyph}>
          <Icon
            name={unreadBelow ? 'arrow.down.circle.fill' : 'chevron.down'}
            size={unreadBelow ? 22 : 15}
            tintColor={colors.tint}
            fallback={<Text color="tint">↓</Text>}
          />
        </Animated.View>
      </Glass>
    </Pressable>
  );
}
