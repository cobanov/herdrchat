import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { avatarColor } from '@/theme/tokens';
import type { AgentStatus } from '@/lib/herdr/models';

/**
 * The app's signature element: a workspace avatar wrapped in a thin ring that
 * BREATHES while the agent is working and holds steady orange when it is waiting
 * on you. A terminal cursor's blink, translated to iOS.
 *
 * Idle workspaces get no ring at all, so attention goes exactly where it should
 * — a list where every row glows is a list with no signal in it.
 */
export function PresenceAvatar({
  title,
  colorKey,
  status,
  size = 52,
}: {
  title: string;
  /** Stable key for the colour, so a rename doesn't reshuffle the list. */
  colorKey: string;
  status: AgentStatus;
  size?: number;
}) {
  const { colors, reduceMotion } = useTheme();
  const pulse = useSharedValue(1);

  const ring =
    status === 'working'
      ? colors.tint
      : status === 'blocked'
        ? colors.attention
        : status === 'done'
          ? colors.tintMuted
          : null;

  const isWorking = status === 'working';

  useEffect(() => {
    if (!isWorking || reduceMotion) {
      cancelAnimation(pulse);
      pulse.set(1);
      return;
    }
    // Runs on the UI thread — a working agent can be on screen for minutes, and
    // a setState loop would be paying the JS bridge the whole time.
    pulse.set(
      withRepeat(
        withTiming(0.35, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        -1,
        true
      )
    );
    return () => cancelAnimation(pulse);
  }, [isWorking, reduceMotion, pulse]);

  const ringStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }));

  const outer = size + 8;

  return (
    <View style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center' }}>
      {ring !== null && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: outer / 2,
              borderWidth: 2,
              borderColor: ring,
            },
            isWorking && ringStyle,
          ]}
        />
      )}
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: avatarColor(colorKey),
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Text
          variant="headline"
          color="onTint"
          weight="600"
          style={{ fontSize: size * 0.36, lineHeight: size * 0.44 }}>
          {initials(title)}
        </Text>
      </View>
    </View>
  );
}

export function initials(title: string): string {
  const letters = title
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => word.charAt(0));
  return letters.length === 0 ? '?' : letters.join('').toUpperCase();
}
