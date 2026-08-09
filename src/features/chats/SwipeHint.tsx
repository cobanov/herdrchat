import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { screenPadding, spacing } from '@/theme/tokens';

/**
 * A one-time nudge that chat rows can be swiped.
 *
 * Shown until the gesture is used once, not for a fixed number of launches: the
 * point is that the reader learns the gesture, and a hint that expires on a
 * timer teaches nothing to someone who was busy the first three times.
 *
 * The chevrons drift left and settle, on a long loop. Enough to read as "this
 * moves", quiet enough to ignore — it sits above a list people open to read, and
 * a hint that keeps pulling the eye is worse than no hint.
 */
export function SwipeHint() {
  const { colors } = useTheme();
  const drift = useSharedValue(0);

  useEffect(() => {
    // `.set()`, not `.value` — the React Compiler is on and flags direct
    // mutation of a shared value.
    drift.set(
      withRepeat(
        withSequence(
          withDelay(1200, withTiming(-6, { duration: 520, easing: Easing.out(Easing.quad) })),
          withTiming(0, { duration: 420, easing: Easing.in(Easing.quad) })
        ),
        -1,
        false
      )
    );
  }, [drift]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: drift.get() }] }));

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        paddingHorizontal: screenPadding,
        paddingVertical: spacing.sm,
      }}>
      <Text variant="caption" color="tertiary">
        Swipe a chat to rename or close it
      </Text>
      <Animated.View style={style}>
        <Icon
          name="chevron.left"
          size={11}
          tintColor={colors.tertiaryLabel}
          fallback={
            <Text variant="caption2" color="tertiary">
              ‹
            </Text>
          }
        />
      </Animated.View>
    </View>
  );
}
