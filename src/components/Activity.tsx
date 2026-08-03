import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/tokens';

/** Three softly pulsing dots. Used beside "working…" wherever presence is shown. */
export function TypingDots({ color, size = 5 }: { color?: string; size?: number }) {
  const { colors, reduceMotion } = useTheme();
  const dotColor = color ?? colors.tint;

  return (
    <View
      style={{ flexDirection: 'row', gap: 3, height: size, alignItems: 'center' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {[0, 1, 2].map((index) => (
        <Dot key={index} index={index} color={dotColor} size={size} still={reduceMotion} />
      ))}
    </View>
  );
}

function Dot({
  index,
  color,
  size,
  still,
}: {
  index: number;
  color: string;
  size: number;
  still: boolean;
}) {
  const opacity = useSharedValue(0.35);

  useEffect(() => {
    if (still) {
      cancelAnimation(opacity);
      opacity.set(0.6);
      return;
    }
    opacity.set(
      withDelay(
        index * 180,
        withRepeat(
          withSequence(
            withTiming(1, { duration: 420, easing: Easing.inOut(Easing.quad) }),
            withTiming(0.35, { duration: 420, easing: Easing.inOut(Easing.quad) })
          ),
          -1,
          false
        )
      )
    );
    return () => cancelAnimation(opacity);
  }, [index, still, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

/**
 * A slim, indeterminate bar shown while the agent works and no live preview
 * could be scraped.
 *
 * Transcripts are turn-granular, so there is no finer token stream to surface —
 * a quiet sweep reads as progress without pretending to show content we don't
 * have.
 */
export function WaitingBar({ height = 3 }: { height?: number }) {
  const { colors, reduceMotion } = useTheme();
  const progress = useSharedValue(0);
  // Measured rather than assumed: the bar is inset inside a thread whose width
  // depends on the device and on Dynamic Type, and the sweep has to travel the
  // real distance or it stalls short of the end.
  const width = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(progress);
      progress.set(0.5);
      return;
    }
    progress.set(
      withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), -1, true)
    );
    return () => cancelAnimation(progress);
  }, [reduceMotion, progress]);

  const style = useAnimatedStyle(() => {
    const measured = width.get();
    const segment = Math.max(48, measured * 0.28);
    return {
      width: segment,
      transform: [{ translateX: (measured - segment) * progress.get() }],
    };
  });

  return (
    <View
      onLayout={(event) => {
        width.set(event.nativeEvent.layout.width);
      }}
      style={{
        height,
        borderRadius: radius.full,
        overflow: 'hidden',
        backgroundColor: colors.tintMuted,
      }}
      accessibilityRole="progressbar"
      accessibilityLabel="Waiting for reply">
      <Animated.View
        style={[{ height, borderRadius: radius.full, backgroundColor: colors.tint }, style]}
      />
    </View>
  );
}
