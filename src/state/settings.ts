import { create } from 'zustand';

import type { ThemePreference } from '@/theme/ThemeProvider';

/**
 * App-wide preferences that aren't tied to a single host.
 *
 * Hydrated once at launch from the `settings` table and written back on change,
 * so the store stays the single source of truth for render and the database is
 * only ever a mirror.
 */
export interface Settings {
  themePreference: ThemePreference;
  /**
   * Show the agent's machinery — tool calls, tool results, thinking — as chips
   * inside bubbles. Off gives you only what the agent actually said, which is
   * what some people want from a phone.
   */
  showToolActivity: boolean;
  /** Subagent chatter. Off by default: it is rarely what you opened the app for. */
  showSidechain: boolean;
  /** Haptic feedback on sends, taps and confirmations. */
  haptics: boolean;
  /** Push notifications when an agent blocks or finishes. */
  notifications: boolean;
}

export const SETTINGS_DEFAULTS: Settings = {
  themePreference: 'system',
  showToolActivity: true,
  showSidechain: false,
  haptics: true,
  notifications: false,
};

interface SettingsState extends Settings {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  hydrate: (values: Partial<Settings>) => void;
}

export const useSettings = create<SettingsState>((setState) => ({
  ...SETTINGS_DEFAULTS,
  set: (key, value) => setState({ [key]: value } as Partial<SettingsState>),
  hydrate: (values) => setState(values as Partial<SettingsState>),
}));

/**
 * Read a boolean setting outside React — the haptics helper needs it from
 * plain event handlers, where a hook isn't available.
 */
export function settingsSnapshot(): Settings {
  const state = useSettings.getState();
  return {
    themePreference: state.themePreference,
    showToolActivity: state.showToolActivity,
    showSidechain: state.showSidechain,
    haptics: state.haptics,
    notifications: state.notifications,
  };
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Settings are stored as strings; these keep the encoding in one place. */
export const encodeBool = (value: boolean) => (value ? '1' : '0');
export const decodeBool = (value: string | null, fallback: boolean) =>
  value === null ? fallback : value === '1';
