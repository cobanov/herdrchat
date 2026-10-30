import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, type ReactNode } from 'react';

import { useConnections } from './connections';
import { getSetting, loadConnections } from './db';
import { useDeviceIcons } from './deviceIcons';
import { loadHostThemes, mirrorHostThemes } from './hostTheme';
import { loadSlashCatalogues, mirrorSlashCatalogues } from './slashCommands';
import { loadUsageConsent } from './usage';
import { decodeListMode } from '@/lib/listModes';
import {
  SETTINGS_DEFAULTS,
  decodeBool,
  decodePollScale,
  decodeUsageShown,
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

  // From launch on, every change to a host's theme is written back.
  useEffect(() => mirrorHostThemes(db), [db]);
  // And to each connection's slash-command catalogue.
  useEffect(() => mirrorSlashCatalogues(db), [db]);

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
        useHostThemes,
        listMode,
        usageShown,
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
          getSetting(db, 'useHostThemes'),
          getSetting(db, 'listMode'),
          getSetting(db, 'usageShown'),
          // Before the connections land, so the selected host opens in its
          // own colours rather than flashing the default first.
          loadHostThemes(db).catch(() => undefined),
          // And the `/` palette is complete from launch, before any scan.
          loadSlashCatalogues(db).catch(() => undefined),
          // The glyph each host was given, so rows draw it from launch.
          useDeviceIcons.getState().load(db).catch(() => undefined),
          // The hosts the person agreed to read Claude usage from, so the
          // footer offers no setup where it is already done.
          loadUsageConsent(db).catch(() => undefined),
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
        useHostThemes: decodeBool(useHostThemes, SETTINGS_DEFAULTS.useHostThemes),
        listMode: decodeListMode(listMode),
        usageShown: decodeUsageShown(usageShown),
      });
      // After the settings: `hydrated` is what the welcome waits on, and it
      // must not read the defaults (never welcomed) for a moment first.
      setAll(connections, selected);
    })();
  }, [db, setAll, hydrateSettings]);

  return <>{children}</>;
}

export { SELECTED_KEY };
