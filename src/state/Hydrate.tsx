import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, type ReactNode } from 'react';

import { useConnections } from './connections';
import { getSetting, loadConnections } from './db';
import {
  SETTINGS_DEFAULTS,
  decodeBool,
  decodePollScale,
  isThemePreference,
  useSettings,
} from './settings';

const SELECTED_KEY = 'selectedConnectionId';

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
  const hydrateSettings = useSettings((state) => state.hydrate);

  useEffect(() => {
    void (async () => {
      const [
        connections,
        selected,
        theme,
        toolActivity,
        sidechain,
        haptics,
        notifications,
        pollScale,
      ] =
        await Promise.all([
          loadConnections(db),
          getSetting(db, SELECTED_KEY),
          getSetting(db, 'themePreference'),
          getSetting(db, 'showToolActivity'),
          getSetting(db, 'showSidechain'),
          getSetting(db, 'haptics'),
          getSetting(db, 'notifications'),
          getSetting(db, 'pollScale'),
        ]);
      setAll(connections, selected);
      hydrateSettings({
        themePreference: isThemePreference(theme) ? theme : SETTINGS_DEFAULTS.themePreference,
        showToolActivity: decodeBool(toolActivity, SETTINGS_DEFAULTS.showToolActivity),
        showSidechain: decodeBool(sidechain, SETTINGS_DEFAULTS.showSidechain),
        haptics: decodeBool(haptics, SETTINGS_DEFAULTS.haptics),
        notifications: decodeBool(notifications, SETTINGS_DEFAULTS.notifications),
        pollScale: decodePollScale(pollScale),
      });
    })();
  }, [db, setAll, hydrateSettings]);

  return <>{children}</>;
}

export { SELECTED_KEY };
