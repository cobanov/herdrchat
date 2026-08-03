import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';

import { darkPalette, lightPalette, type Palette } from './tokens';

export type ColorSchemeName = 'light' | 'dark';
export type ThemePreference = 'system' | ColorSchemeName;

export interface Theme {
  scheme: ColorSchemeName;
  colors: Palette;
  /**
   * The user asked for less transparency. Every glass surface must fall back to
   * a solid one, and this is the single place that decides it.
   */
  reduceTransparency: boolean;
  /** The user asked for less movement. Non-essential animation is disabled. */
  reduceMotion: boolean;
}

const ThemeContext = createContext<Theme | null>(null);
const PreferenceContext = createContext<{
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
} | null>(null);

export function ThemeProvider({
  children,
  preference: controlledPreference,
  onPreferenceChange,
}: {
  children: ReactNode;
  preference?: ThemePreference;
  onPreferenceChange?: (next: ThemePreference) => void;
}) {
  const systemScheme = useColorScheme();
  const [localPreference, setLocalPreference] = useState<ThemePreference>('system');
  const preference = controlledPreference ?? localPreference;

  const [reduceTransparency, setReduceTransparency] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Read the current value AND subscribe: the settings can change while the
    // app is open, and a glass surface that only checked at mount would keep
    // rendering transparent after the user turned it off.
    void AccessibilityInfo.isReduceTransparencyEnabled().then((enabled) => {
      if (!cancelled) setReduceTransparency(enabled);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setReduceMotion(enabled);
    });

    const transparencySubscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReduceTransparency
    );
    const motionSubscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion
    );
    return () => {
      cancelled = true;
      transparencySubscription.remove();
      motionSubscription.remove();
    };
  }, []);

  const theme = useMemo<Theme>(() => {
    const scheme: ColorSchemeName =
      preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;
    return {
      scheme,
      colors: scheme === 'dark' ? darkPalette : lightPalette,
      reduceTransparency,
      reduceMotion,
    };
  }, [preference, systemScheme, reduceTransparency, reduceMotion]);

  const preferenceValue = useMemo(
    () => ({
      preference,
      setPreference: onPreferenceChange ?? setLocalPreference,
    }),
    [preference, onPreferenceChange]
  );

  return (
    <PreferenceContext value={preferenceValue}>
      <ThemeContext value={theme}>{children}</ThemeContext>
    </PreferenceContext>
  );
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (theme === null) {
    throw new Error('useTheme must be used inside a ThemeProvider');
  }
  return theme;
}

export function useThemePreference() {
  const value = useContext(PreferenceContext);
  if (value === null) {
    throw new Error('useThemePreference must be used inside a ThemeProvider');
  }
  return value;
}
