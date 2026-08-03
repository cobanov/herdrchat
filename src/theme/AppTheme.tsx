import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, type ReactNode } from 'react';

import { ThemeProvider, type ThemePreference } from './ThemeProvider';
import { setSetting } from '@/state/db';
import { useSettings } from '@/state/settings';

/**
 * Wires the theme provider to persisted state.
 *
 * Kept apart from `ThemeProvider` so the provider itself stays free of storage
 * and can be rendered in a test or a screenshot harness without a database.
 */
export function AppTheme({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const preference = useSettings((state) => state.themePreference);
  const set = useSettings((state) => state.set);

  const change = useCallback(
    (next: ThemePreference) => {
      set('themePreference', next);
      void setSetting(db, 'themePreference', next);
    },
    [db, set]
  );

  return (
    <ThemeProvider preference={preference} onPreferenceChange={change}>
      {children}
    </ThemeProvider>
  );
}
