import { unstable_settings } from '../../../../app/_layout';

// The real root layout pulls in the navigator, the database, notifications and
// the theme; none of that matters to which route it anchors the stack on.
jest.mock('expo-router', () => ({
  DarkTheme: { colors: {} },
  DefaultTheme: { colors: {} },
  Stack: Object.assign(() => null, { Screen: () => null }),
  ThemeProvider: () => null,
}));
jest.mock('expo-notifications', () => ({ setNotificationHandler: jest.fn() }));
jest.mock('expo-sqlite', () => ({ SQLiteProvider: () => null }));
jest.mock('expo-system-ui', () => ({ setBackgroundColorAsync: jest.fn() }));
jest.mock('@/features/notifications/useNotificationRouting', () => ({
  useNotificationRouting: jest.fn(),
  usePushTokenRefresh: jest.fn(),
}));
jest.mock('@/state/db', () => ({ DATABASE_NAME: 'test.db', migrate: jest.fn() }));
jest.mock('@/state/Hydrate', () => ({ Hydrate: () => null }));
jest.mock('@/theme/AppTheme', () => ({ AppTheme: () => null }));

/**
 * A cold link straight to a presented screen (`herdrchat://settings?section=…`,
 * the HighlightOnLink route, or `/hosts`) used to build a stack of that sheet
 * alone: Done's `back()` had nowhere to go and the person was stuck in it.
 * Anchoring the root stack on the chats puts them underneath every such link.
 * Expo Router itself does not load under this jest setup, so the behaviour is
 * checked by the cold-link step in `.maestro/regression/menu.yaml`; this pins
 * the setting that produces it.
 */
it('anchors the root stack on the chats', () => {
  expect(unstable_settings).toEqual({ anchor: 'index' });
});
