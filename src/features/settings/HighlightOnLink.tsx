import { useEffect, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

/** The sections a link can point at. Typed, so a stale link is a build error. */
export const SETTINGS_SECTIONS = ['notifications', 'conversations', 'support', 'danger'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function isSettingsSection(value: unknown): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly unknown[]).includes(value);
}

/**
 * Wraps a settings section so a deep link can scroll to it and say so.
 *
 * The scroll alone is not enough. Landing partway down a screen of near-identical
 * grey cards, having arrived from somewhere else, the reader has no way to tell
 * which of the three visible groups they were sent to — so the target pulses
 * once behind its card.
 *
 * A pulse, not a persistent highlight: it has to be over before the reader
 * starts using the control, or it becomes a state they have to dismiss.
 */
export function HighlightOnLink({
  section,
  target,
  onMeasure,
  children,
}: {
  section: SettingsSection;
  /** The section the link asked for, if any. */
  target: SettingsSection | null;
  /** Reports this section's y offset so the screen can scroll to it. */
  onMeasure: (section: SettingsSection, y: number) => void;
  children: ReactNode;
}) {
  const { colors, reduceMotion } = useTheme();
  const glow = useSharedValue(0);
  const [measured, setMeasured] = useState(false);

  const isTarget = target === section;

  useEffect(() => {
    if (!isTarget) return;
    // Reduce Motion still gets the cue — it is information, not decoration — but
    // as a hold-and-fade rather than a pulse.
    glow.set(
      reduceMotion
        ? withSequence(
            withTiming(1, { duration: 1 }),
            withDelay(1400, withTiming(0, { duration: 600 }))
          )
        : withSequence(
            withTiming(1, { duration: 420, easing: Easing.out(Easing.quad) }),
            withDelay(900, withTiming(0, { duration: 700, easing: Easing.in(Easing.quad) }))
          )
    );
  }, [isTarget, glow, reduceMotion]);

  const style = useAnimatedStyle(() => ({ opacity: glow.get() }));

  const handleLayout = (event: LayoutChangeEvent) => {
    // Once. `onLayout` fires again on every reflow — a note appearing under the
    // notifications switch is one — and re-reporting would make the screen
    // consider scrolling long after the link that asked for it was handled.
    if (measured) return;
    setMeasured(true);
    onMeasure(section, event.nativeEvent.layout.y);
  };

  return (
    <View onLayout={handleLayout}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            // Bleeds past the card so the glow reads as being behind it rather
            // than as another border drawn on top.
            top: -spacing.xs,
            left: -spacing.xs,
            right: -spacing.xs,
            bottom: -spacing.xs,
            borderRadius: radius.md,
            backgroundColor: colors.tintMuted,
          },
          style,
        ]}
      />
      {children}
    </View>
  );
}
