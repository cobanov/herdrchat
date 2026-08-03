import { create } from 'zustand';

import type { ThemePreference } from '@/theme/ThemeProvider';

/**
 * App-wide preferences that aren't tied to a single server.
 *
 * Hydrated once at launch from the `settings` table and written back on change,
 * so the store stays the single source of truth for render and the database is
 * only ever a mirror.
 */
interface SettingsState {
  themePreference: ThemePreference;
  setThemePreference: (next: ThemePreference) => void;
}

export const useSettings = create<SettingsState>((set) => ({
  themePreference: 'system',
  setThemePreference: (next) => set({ themePreference: next }),
}));

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}
