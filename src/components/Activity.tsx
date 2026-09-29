import { useEffect, useState } from 'react';
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

import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { activity, radius, spacing } from '@/theme/tokens';

/** Three softly pulsing dots. Used beside "working…" wherever presence is shown. */
export function TypingDots({ color, size = 5 }: { color?: string; size?: number }) {
  const { colors, reduceMotion } = useTheme();
  const dotColor = color ?? colors.tint;

  return (
    <View
      style={{ flexDirection: 'row', gap: spacing.xs, height: size, alignItems: 'center' }}
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

/**
 * "Working… 2m 13s" under the conversation while the agent is busy, with a
 * small grid of dots breathing in a diagonal wave (after zeron's).
 *
 * The clock starts when this mounts, which is when the thread first saw the
 * agent working: it says how long you have been waiting, not how long the
 * turn has run on the host, which the status does not report.
 */
export function WorkingIndicator({ writing }: { writing: boolean }) {
  const { colors, reduceMotion } = useTheme();
  const [since] = useState(() => Date.now());
  const [now, setNow] = useState(since);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const tints = [colors.tint, colors.attention, colors.destructive];

  return (
    <View
      testID="working-indicator"
      accessibilityRole="progressbar"
      accessibilityLabel={`${writing ? 'Writing' : 'Working'}, ${elapsed(now - since)}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <View style={{ gap: activity.gridGap }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {tints.map((tint, row) => (
          <View key={row} style={{ flexDirection: 'row', gap: activity.gridGap }}>
            {[0, 1, 2].map((column) => (
              <GridDot key={column} color={tint} delay={((2 - row + Math.abs(column - 1)) / 4) * activity.gridCycle} still={reduceMotion} />
            ))}
          </View>
        ))}
      </View>
      <Text variant="footnote" weight="500" color="secondary">
        {writing ? 'Writing…' : 'Working…'}
      </Text>
      <Text variant="footnote" color="tertiary" style={{ fontVariant: ['tabular-nums'] }}>
        {elapsed(now - since)}
      </Text>
    </View>
  );
}

/** "12s", "11m 43s", "1h 5m". */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function GridDot({ color, delay, still }: { color: string; delay: number; still: boolean }) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (still) {
      cancelAnimation(opacity);
      opacity.set(0.6);
      return;
    }
    const half = activity.gridCycle / 2;
    opacity.set(
      withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(0.12, { duration: half, easing: Easing.inOut(Easing.quad) }),
            withTiming(1, { duration: half, easing: Easing.inOut(Easing.quad) })
          ),
          -1,
          false
        )
      )
    );
    return () => cancelAnimation(opacity);
  }, [delay, still, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View
      style={[{ width: activity.gridDot, height: activity.gridDot, borderRadius: radius.full, backgroundColor: color }, style]}
    />
  );
}
