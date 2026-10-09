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
        returnSends,
        notifications,
        pollScale,
        seenSwipeHint,
        welcomeSeen,
        starAsked,
        activeDays,
      ] =
        await Promise.all([
          loadConnections(db),
          getSetting(db, SELECTED_KEY),
          getSetting(db, 'themePreference'),
          getSetting(db, 'showToolActivity'),
          getSetting(db, 'showSidechain'),
          getSetting(db, 'haptics'),
          getSetting(db, 'returnSends'),
          getSetting(db, 'notifications'),
          getSetting(db, 'pollScale'),
          getSetting(db, 'seenSwipeHint'),
          getSetting(db, 'welcomeSeen'),
          getSetting(db, 'starAsked'),
          getSetting(db, 'activeDays'),
        ]);
      hydrateSettings({
        themePreference: isThemePreference(theme) ? theme : SETTINGS_DEFAULTS.themePreference,
        showToolActivity: decodeBool(toolActivity, SETTINGS_DEFAULTS.showToolActivity),
        showSidechain: decodeBool(sidechain, SETTINGS_DEFAULTS.showSidechain),
        haptics: decodeBool(haptics, SETTINGS_DEFAULTS.haptics),
        returnSends: decodeBool(returnSends, SETTINGS_DEFAULTS.returnSends),
        notifications: decodeBool(notifications, SETTINGS_DEFAULTS.notifications),
        pollScale: decodePollScale(pollScale),
        seenSwipeHint: decodeBool(seenSwipeHint, SETTINGS_DEFAULTS.seenSwipeHint),
        welcomeSeen: decodeBool(welcomeSeen, SETTINGS_DEFAULTS.welcomeSeen),
        starAsked: decodeBool(starAsked, SETTINGS_DEFAULTS.starAsked),
        activeDays: activeDays ?? SETTINGS_DEFAULTS.activeDays,
      });
      // After the settings: `hydrated` is what the welcome waits on, and it
      // must not read the defaults (never welcomed) for a moment first.
      setAll(connections, selected);
    })();
  }, [db, setAll, hydrateSettings]);

  return <>{children}</>;
}

export { SELECTED_KEY };
