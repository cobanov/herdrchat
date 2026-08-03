import { BlurView } from 'expo-blur';
import {
  GlassContainer as ExpoGlassContainer,
  GlassView,
  isGlassEffectAPIAvailable,
} from 'expo-glass-effect';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';

import { useTheme } from '@/theme/ThemeProvider';

/**
 * The ONLY file in the app that imports `expo-glass-effect`.
 *
 * Everything else renders `<Glass>` and gets the availability check and the
 * fallback chain for free. That matters for more than tidiness: some iOS 26
 * builds ship without the glass API, and rendering a GlassView on those crashes
 * — so the guard has to be somewhere it cannot be forgotten.
 *
 * Fallback chain, in order:
 *   1. Liquid Glass  — iOS 26+ where the runtime API is actually present
 *   2. BlurView      — older iOS, which has no Liquid Glass but does have blur
 *   3. Solid surface — Android, and anywhere Reduce Transparency is on
 */

export type GlassVariant = 'regular' | 'clear';

export interface GlassProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: GlassVariant;
  /** Reacts to touch. Only for surfaces that are themselves a control. */
  interactive?: boolean;
  tintColor?: string;
  testID?: string;
}

/**
 * Whether real Liquid Glass will render right now. Exported so a caller can
 * decide *layout* (e.g. how much padding a floating bar needs), never to
 * re-implement the fallback — that lives here.
 */
export function useGlassAvailable(): boolean {
  const { reduceTransparency } = useTheme();
  return Platform.OS === 'ios' && !reduceTransparency && isGlassEffectAPIAvailable();
}

export function Glass({
  children,
  style,
  variant = 'regular',
  interactive = false,
  tintColor,
  testID,
}: GlassProps) {
  const { colors, scheme, reduceTransparency } = useTheme();

  if (reduceTransparency) {
    return (
      <View style={[{ backgroundColor: colors.glassFallback }, style]} testID={testID}>
        {children}
      </View>
    );
  }

  if (Platform.OS === 'ios' && isGlassEffectAPIAvailable()) {
    return (
      <GlassView
        style={style}
        glassEffectStyle={variant}
        isInteractive={interactive}
        tintColor={tintColor}
        testID={testID}>
        {children}
      </GlassView>
    );
  }

  if (Platform.OS === 'ios') {
    // iOS below 26: no Liquid Glass, but blur still reads as a floating surface.
    return (
      <View style={[styles.clip, style]} testID={testID}>
        <BlurView
          intensity={variant === 'clear' ? 40 : 70}
          tint={scheme === 'dark' ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        {children}
      </View>
    );
  }

  return (
    <View style={[{ backgroundColor: colors.glassFallback }, style]} testID={testID}>
      {children}
    </View>
  );
}

/**
 * Groups nearby glass surfaces so they merge and morph into each other the way
 * the system's own do, instead of reading as two unrelated slabs. `spacing`
 * should match the gap between the children — that is what lets the shapes
 * blend mid-transition.
 *
 * A plain View everywhere the real container isn't available, so callers never
 * need a conditional.
 */
export function GlassContainer({
  children,
  spacing,
  style,
}: {
  children: ReactNode;
  spacing: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { reduceTransparency } = useTheme();

  if (Platform.OS === 'ios' && !reduceTransparency && isGlassEffectAPIAvailable()) {
    return (
      <ExpoGlassContainer spacing={spacing} style={style}>
        {children}
      </ExpoGlassContainer>
    );
  }
  return <View style={style}>{children}</View>;
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
