import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';

import { TypingDots } from '@/components/Activity';
import { Text } from '@/components/Text';
import { connectingTitle, SLOW_CONNECT_MS } from '@/lib/connecting';
import { useTheme } from '@/theme/ThemeProvider';
import { connecting, radius, screenPadding, spacing } from '@/theme/tokens';
import { AVATAR_SIZE } from './ChatRow';

/**
 * A shaped skeleton rather than a bare spinner: the row layout is known, so
 * showing it stops the list from jumping when data lands.
 *
 * The rows breathe, so a slow host does not look like a frozen app, and after
 * a few seconds the list says what usually causes it: the phone is off the
 * tailnet or the computer is asleep. Keyed by host where it is used, so the
 * clock starts again for each host.
 */
export function SkeletonRows({ host }: { host: { name: string; host: string } }) {
  const { colors } = useTheme();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_CONNECT_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View testID="chats-connecting" style={{ paddingHorizontal: screenPadding, paddingTop: spacing.sm, gap: spacing.lg }}>
      {[0, 1, 2, 3].map((index) => (
        <SkeletonRow key={index} index={index} />
      ))}
      <View style={{ alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }} accessibilityLiveRegion="polite">
          <TypingDots color={colors.tint} />
          <Text variant="subhead" color="secondary">
            {connectingTitle(host)}
          </Text>
        </View>
        {slow && (
          <Text testID="chats-connecting-hint" variant="footnote" color="secondary" style={{ textAlign: 'center' }}>
            This is taking longer than usual. Check that this phone can reach your computer: Tailscale is on here,
            and the computer is awake and on the same tailnet.
          </Text>
        )}
      </View>
    </View>
  );
}

function SkeletonRow({ index }: { index: number }) {
  const { colors, reduceMotion } = useTheme();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(opacity);
      opacity.set(1);
      return;
    }
    opacity.set(
      withDelay(
        index * connecting.skeletonStagger,
        withRepeat(withTiming(connecting.skeletonDim, { duration: connecting.skeletonCycle / 2, easing: Easing.inOut(Easing.quad) }), -1, true)
      )
    );
    return () => cancelAnimation(opacity);
  }, [opacity, index, reduceMotion]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  return (
    <Animated.View
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.sm, backgroundColor: colors.chatCard },
        style,
      ]}>
      <View style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: radius.sm, backgroundColor: colors.fillSubtle }} />
      <View style={{ flex: 1, gap: spacing.sm }}>
        <View style={{ height: spacing.lg, width: '45%', borderRadius: radius.full, backgroundColor: colors.fillSubtle }} />
        <View style={{ height: spacing.md, width: '75%', borderRadius: radius.full, backgroundColor: colors.fillSubtle }} />
      </View>
    </Animated.View>
  );
}
