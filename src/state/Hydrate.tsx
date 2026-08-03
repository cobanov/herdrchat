import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, type ReactNode } from 'react';

import { useConnections } from './connections';
import { getSetting, loadConnections } from './db';
import { isThemePreference, useSettings } from './settings';

const SELECTED_KEY = 'selectedConnectionId';
const THEME_KEY = 'themePreference';

/**
 * Loads persisted state into the stores before the tree below it renders
 * anything that depends on it.
 *
 * Children render immediately rather than behind a spinner: every screen already
 * handles "no servers yet", and flashing a loader for a query that takes a few
 * milliseconds is worse than briefly showing the empty state it resolves to.
 */
export function Hydrate({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const setAll = useConnections((state) => state.setAll);
  const setThemePreference = useSettings((state) => state.setThemePreference);

  useEffect(() => {
    void (async () => {
      const [connections, selected, theme] = await Promise.all([
        loadConnections(db),
        getSetting(db, SELECTED_KEY),
        getSetting(db, THEME_KEY),
      ]);
      setAll(connections, selected);
      if (isThemePreference(theme)) setThemePreference(theme);
    })();
  }, [db, setAll, setThemePreference]);

  return <>{children}</>;
}

export { SELECTED_KEY };
