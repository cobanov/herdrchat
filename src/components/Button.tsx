import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, motion, radius, spacing } from '@/theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type ButtonVariant = 'filled' | 'tinted' | 'plain' | 'destructive';

/**
 * The app's button. Scales slightly under a finger with an interruptible spring
 * — no bounce, because a control that wobbles after a tap reads as a toy — and
 * fires the haptic appropriate to what it does.
 */
export function Button({
  title,
  onPress,
  variant = 'filled',
  loading = false,
  disabled = false,
  testID,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const { colors, reduceMotion } = useTheme();
  const scale = useSharedValue(1);
  const inactive = disabled || loading;

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const background =
    variant === 'filled'
      ? colors.tint
      : variant === 'destructive'
        ? colors.destructive
        : variant === 'tinted'
          ? colors.tintMuted
          : 'transparent';
  const labelColor = variant === 'filled' || variant === 'destructive' ? 'onTint' : 'tint';

  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPressIn={() => {
        if (!reduceMotion) scale.set(withSpring(0.96, motion.press));
      }}
      onPressOut={() => {
        scale.set(withSpring(1, motion.press));
      }}
      onPress={() => {
        if (Platform.OS === 'ios') {
          void Haptics.impactAsync(
            variant === 'destructive'
              ? Haptics.ImpactFeedbackStyle.Medium
              : Haptics.ImpactFeedbackStyle.Light
          );
        }
        onPress();
      }}
      style={[
        {
          minHeight: minTouchTarget,
          paddingHorizontal: spacing.xl,
          borderRadius: radius.lg,
          backgroundColor: background,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: inactive ? 0.45 : 1,
        },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={variant === 'filled' ? colors.onTint : colors.tint} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text variant="headline" color={labelColor}>
            {title}
          </Text>
        </View>
      )}
    </AnimatedPressable>
  );
}
