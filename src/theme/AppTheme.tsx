import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, type ReactNode } from 'react';

import { ThemeProvider, type ThemePreference } from './ThemeProvider';
import { useConnections } from '@/state/connections';
import { setSetting } from '@/state/db';
import { useHostTheme } from '@/state/hostTheme';
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
  // The selected host's theme, so switching hosts switches colours. Read
  // whatever the setting says and dropped below, rather than selected
  // conditionally, to keep the subscriptions the same on every render.
  const useHostThemes = useSettings((state) => state.useHostThemes);
  const selectedId = useConnections((state) => state.selectedId);
  const hostTheme = useHostTheme((state) =>
    selectedId === null ? undefined : state.byConnection[selectedId]
  );
  const applied = useHostThemes ? hostTheme : undefined;

  const change = useCallback(
    (next: ThemePreference) => {
      set('themePreference', next);
      void setSetting(db, 'themePreference', next);
    },
    [db, set]
  );

  return (
    <ThemeProvider
      preference={preference}
      onPreferenceChange={change}
      overrides={applied?.overrides}
      hostThemeName={applied?.status === 'present' ? applied.name : null}>
      {children}
    </ThemeProvider>
  );
}
