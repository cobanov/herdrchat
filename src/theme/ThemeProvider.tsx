import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Appearance, useColorScheme } from 'react-native';

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

  /*
    Push the preference down to UIKit, not just into our palette.

    Some surfaces are not ours to colour. The tab bar is a real UIKit tab bar
    (see app/(tabs)/_layout.tsx — deliberately, so it minimises and blurs the way
    the system's does), and it reads the window's trait collection rather than
    anything in this file. So with the app set to light on a phone set to dark it
    rendered as a dark slab under a light screen, and every other native surface
    — action sheets, the keyboard, menus — did the same.

    `Appearance.setColorScheme` sets overrideUserInterfaceStyle on the app's
    windows, which is the one lever that reaches all of them at once.
    'unspecified' hands control back to the OS — React Native's own name for it,
    not null, which the typing rejects.

    Note this does NOT make `useColorScheme()` above lie to us: the only time we
    read it is when preference is 'system', and that is precisely when the
    override is null.
  */
  useEffect(() => {
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  }, [preference]);

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
