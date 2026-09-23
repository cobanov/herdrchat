import { BlurView } from 'expo-blur';
import {
  GlassContainer as ExpoGlassContainer,
  GlassView,
  isGlassEffectAPIAvailable,
} from 'expo-glass-effect';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';

import { useTheme } from '@/theme/ThemeProvider';
import { glass, motion } from '@/theme/tokens';

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
 *
 * Edge-attached navigation chrome uses the system blur material on iOS;
 * Liquid Glass remains reserved for its floating controls.
 */

export type GlassVariant = 'regular' | 'clear';

export interface GlassProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: GlassVariant;
  /** Reacts to touch. Only for surfaces that are themselves a control. */
  interactive?: boolean;
  /** Continuous navigation chrome, not a floating Liquid Glass lens. */
  edgeAttached?: boolean;
  tintColor?: string;
  /**
   * Dematerialise the lens without unmounting it, animated.
   *
   * The only way to fade real glass: opacity on a GlassView or on any ancestor
   * switches the effect off, so instead its style animates to 'none'. Only
   * meaningful where `useGlassAvailable()` is true; a caller fades the other
   * branches the ordinary way, and they render nothing while hidden.
   */
  hidden?: boolean;
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
  edgeAttached = false,
  tintColor,
  hidden = false,
  testID,
}: GlassProps) {
  const { colors, scheme, reduceTransparency, reduceMotion } = useTheme();

  if (reduceTransparency) {
    if (hidden) return null;
    return (
      <View style={[{ backgroundColor: colors.glassFallback }, style]} testID={testID}>
        {children}
      </View>
    );
  }

  if (Platform.OS === 'ios' && !edgeAttached && isGlassEffectAPIAvailable()) {
    return (
      <GlassView
        style={style}
        glassEffectStyle={{
          style: hidden ? 'none' : variant,
          animate: !reduceMotion,
          animationDuration: motion.fade / 1000,
        }}
        isInteractive={interactive}
        tintColor={tintColor}
        // Without this the glass follows the SYSTEM appearance while everything
        // drawn on it follows the app's theme, and the two disagree the moment a
        // user picks a theme that is not "system". Phone in light, app in dark,
        // and the blocked bar became a near-white slab with amber text on it —
        // the worst possible place for it, since that bar is how a waiting agent
        // gets answered.
        //
        // `scheme` is already resolved past the 'system' preference by
        // ThemeProvider, so it is exactly the answer this prop wants. The
        // BlurView branch below has always used it; only this one ignored it.
        colorScheme={scheme === 'dark' ? 'dark' : 'light'}
        testID={testID}>
        {children}
      </GlassView>
    );
  }

  if (hidden) return null;

  if (Platform.OS === 'ios') {
    // Edge-attached chrome uses system navigation material, not a rounded lens.
    // The same BlurView also backs floating surfaces on iOS below 26.
    return (
      <View style={[styles.clip, style]} testID={testID}>
        <BlurView
          intensity={
            edgeAttached
              ? glass.chromeIntensity
              : variant === 'clear' ? glass.clearIntensity : glass.regularIntensity
          }
          tint={edgeAttached
            ? scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'
            : scheme === 'dark' ? 'dark' : 'light'}
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
