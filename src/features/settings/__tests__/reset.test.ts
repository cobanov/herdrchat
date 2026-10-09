import type { SQLiteDatabase } from 'expo-sqlite';

import { resolveHostTheme } from '@/lib/theme/resolve';
import { hostMachinesKey, hostThemeKey } from '@/state/db';
import { useHostMachines } from '@/state/hostMachines';
import { useHostTheme } from '@/state/hostTheme';
import { darkPalette, lightPalette } from '@/theme/tokens';

import { resetAppData } from '../reset';

jest.mock('@/features/notifications/deviceId', () => ({ getPushDeviceId: async () => 'device' }));
jest.mock('@/features/notifications/push', () => ({ deviceFileId: (id: string) => id, removePushToken: async () => undefined }));
jest.mock('@/state/attachmentFiles', () => ({ clearAttachmentCopies: () => undefined }));
jest.mock('@/state/Hydrate', () => ({ SELECTED_KEY: 'selectedConnection' }));
jest.mock('@/state/connections', () => ({
  DEMO_CONNECTION_ID: 'demo',
  clearSecrets: async () => undefined,
  clientFor: () => ({ transport: { exec: async () => ({ ok: true, exitCode: 0, stdout: '', stderr: '' }) } }),
  invalidateClient: async () => undefined,
}));

/** The settings table as a map, and every other statement accepted and ignored. */
function fakeDb(initial: Record<string, string>) {
  const rows = new Map(Object.entries(initial));
  const db = {
    runAsync: async (sql: string, key: string) => {
      // clearConnectionSettings: `<name>.<id>`, and `<name>.<id>/<machine>`.
      if (sql.startsWith('DELETE FROM settings WHERE (length(key) > length(?)')) {
        for (const stored of [...rows.keys()]) {
          if ((stored.length > key.length && stored.endsWith(key)) || stored.indexOf(`${key}/`) > 0) rows.delete(stored);
        }
      } else if (sql.startsWith('DELETE FROM settings WHERE key = ?')) rows.delete(key);
    },
    withTransactionAsync: async (task: () => Promise<void>) => task(),
  } as unknown as SQLiteDatabase;
  return { db, rows };
}

// Erasing removed the cached theme's row, but the theme in memory stayed on
// screen until the next launch found the row gone.
it('erases each host’s theme and machines, in the table and on screen', async () => {
  const { db, rows } = fakeDb({
    [hostThemeKey('demo')]: '{"kind":"missing"}',
    [hostMachinesKey('demo')]: '[{"id":"demo-nuku","target":"nuku"}]',
    'lastCwd.demo/demo-nuku': '/home/demo',
  });
  useHostMachines.getState().set('demo', [{ id: 'demo-nuku', label: 'nuku', target: 'nuku', session: 'default', enabled: true }]);
  const theme = resolveHostTheme(
    { kind: 'present', mtime: 1, text: '{"accent":"#B5562F"}' },
    { light: lightPalette, dark: darkPalette }
  );
  useHostTheme.getState().set('demo', theme);
  const demo = { id: 'demo', name: 'Demo', host: 'demo', port: 22, username: 'demo' };
  const { remaining } = await resetAppData(db, [demo] as unknown as Parameters<typeof resetAppData>[1]);
  expect(remaining).toEqual([]);
  expect(useHostTheme.getState().byConnection.demo).toBeUndefined();
  expect(rows.has(hostThemeKey('demo'))).toBe(false);
  expect(useHostMachines.getState().byHost.demo).toBeUndefined();
  expect([...rows.keys()]).toEqual([]);
});
