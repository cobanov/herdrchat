import type { SQLiteDatabase } from 'expo-sqlite';

import type { ExecResult } from '../../../modules/herdr-ssh/src';
import type { DemoHost } from '@/lib/demo/host';
import type { HerdrTransport } from '@/lib/herdr/transport';
import { THEME_BEGIN, THEME_MISSING } from '@/lib/theme/hostTheme';
import { THEME_EXAMPLE_FILE, THEME_README_FILE, THEME_SCHEMA_FILE } from '@/lib/theme/schema';
import { clientFor, demoConnection, DEMO_CONNECTION_ID, useConnections } from '../connections';
import { hostThemeKey } from '../db';
import {
  checkHostTheme,
  fileOf,
  loadHostThemes,
  mirrorHostThemes,
  resetHostThemeSession,
  resolveFile,
  useHostTheme,
} from '../hostTheme';
import { reloadHostTheme, resetHostThemeToDefault } from '../hostThemeActions';

jest.mock('@/lib/herdr/sshTransport', () => ({ SshHerdrTransport: class {} }));

/** The settings table, in memory, answering the three statements host themes use. */
function fakeDb(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  const db = {
    getAllAsync: async (_sql: string, prefix: string) =>
      [...rows].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })),
    runAsync: async (sql: string, key: string, value?: string) => {
      if (sql.startsWith('INSERT INTO settings')) rows.set(key, value!);
      else if (sql.startsWith('DELETE FROM settings WHERE key = ?')) rows.delete(key);
      else throw new Error(`unexpected ${sql}`);
    },
  } as unknown as SQLiteDatabase;
  return { db, rows };
}

const ok = (stdout: string): ExecResult => ({ ok: true, exitCode: 0, stdout, stderr: '' });

/** A host with a theme.json that can be edited between checks. */
function host(initial: { mtime: number; text: string } | null) {
  let file = initial;
  const commands: string[] = [];
  let down = false;
  const transport: HerdrTransport = {
    exec: async (command) => {
      commands.push(command);
      if (down) return { ok: false, code: 'connect_failed', message: 'down' };
      if (command.includes(THEME_BEGIN)) {
        if (file === null) return ok(`${THEME_MISSING}\n`);
        const last = /if \[ "\$m" = "([^"]*)" \]/.exec(command)?.[1];
        return ok(last === String(file.mtime) ? `${file.mtime}\n` : `${file.mtime}\n${THEME_BEGIN}\n${file.text}`);
      }
      return ok('');
    },
    streamLines: async function* () {
      yield* [];
    },
  };
  return {
    transport,
    commands,
    edit: (next: { mtime: number; text: string } | null) => { file = next; },
    setDown: (value: boolean) => { down = value; },
  };
}

const WARM = '{"name":"Warm","accent":"#B5562F"}';

beforeEach(() => resetHostThemeSession());

describe('persistence', () => {
  it('round-trips a host theme through the settings table', async () => {
    const { db, rows } = fakeDb();
    const stop = mirrorHostThemes(db);
    const theme = resolveFile({ kind: 'present', mtime: 42, text: WARM });
    useHostTheme.getState().set('h1', theme);
    useHostTheme.getState().set('h2', resolveFile({ kind: 'missing' }));
    await Promise.resolve();
    stop();
    expect([...rows.keys()].sort()).toEqual([hostThemeKey('h1'), hostThemeKey('h2')]);

    // A relaunch: an empty store, filled from the table and re-resolved.
    resetHostThemeSession();
    await loadHostThemes(db);
    const back = useHostTheme.getState().byConnection;
    expect(back.h1).toEqual(theme);
    expect(back.h1?.name).toBe('Warm');
    expect(back.h1?.overrides.light?.tint).toBe('#B5562F');
    expect(fileOf(back.h1)).toEqual({ kind: 'present', mtime: 42, text: WARM });
    expect(back.h2?.status).toBe('missing');
  });

  it('skips a row it cannot read, and does not write the launch back', async () => {
    const { db, rows } = fakeDb({ [hostThemeKey('bad')]: 'not json', [hostThemeKey('ok')]: '{"kind":"missing"}' });
    const runAsync = jest.spyOn(db, 'runAsync');
    const stop = mirrorHostThemes(db);
    await loadHostThemes(db);
    stop();
    expect(Object.keys(useHostTheme.getState().byConnection)).toEqual(['ok']);
    expect(runAsync).not.toHaveBeenCalled();
    expect(rows.size).toBe(2);
  });

  it('deletes the row of a cleared host', async () => {
    const { db, rows } = fakeDb();
    const stop = mirrorHostThemes(db);
    useHostTheme.getState().set('h1', resolveFile({ kind: 'missing' }));
    useHostTheme.getState().clear('h1');
    await Promise.resolve();
    stop();
    expect(rows.size).toBe(0);
  });

  it('keeps what a check found when the stored themes load after it', async () => {
    const { db } = fakeDb({ [hostThemeKey('h1')]: '{"kind":"missing"}' });
    useHostTheme.getState().set('h1', resolveFile({ kind: 'present', mtime: 2, text: WARM }));
    await loadHostThemes(db);
    expect(useHostTheme.getState().byConnection.h1?.name).toBe('Warm');
  });
});

describe('checkHostTheme', () => {
  it('stores the file, then costs only an mtime while it is unchanged', async () => {
    const h = host({ mtime: 10, text: WARM });
    expect(await checkHostTheme('h', h.transport)).toBe(true);
    const first = useHostTheme.getState().byConnection.h;
    expect(first?.name).toBe('Warm');

    expect(await checkHostTheme('h', h.transport)).toBe(true);
    expect(useHostTheme.getState().byConnection.h).toBe(first);
    expect(h.commands.at(-1)).toContain('"10"');

    h.edit({ mtime: 11, text: '{"name":"Cool"}' });
    await checkHostTheme('h', h.transport);
    expect(useHostTheme.getState().byConnection.h?.name).toBe('Cool');

    // Removed on the host: back to the app's own colours.
    h.edit(null);
    await checkHostTheme('h', h.transport);
    expect(useHostTheme.getState().byConnection.h?.status).toBe('missing');
  });

  it('writes the reference files once a session, after the first check that works', async () => {
    const h = host(null);
    h.setDown(true);
    expect(await checkHostTheme('h', h.transport)).toBe(false);
    expect(h.commands.some((command) => command.includes('mkdir -p'))).toBe(false);
    h.setDown(false);
    await checkHostTheme('h', h.transport);
    await checkHostTheme('h', h.transport);
    expect(h.commands.filter((command) => command.includes('mkdir -p'))).toHaveLength(1);
  });

  it('keeps the theme it has when a check fails', async () => {
    const h = host({ mtime: 10, text: WARM });
    await checkHostTheme('h', h.transport);
    const before = useHostTheme.getState().byConnection.h;
    h.setDown(true);
    expect(await checkHostTheme('h', h.transport)).toBe(false);
    expect(useHostTheme.getState().byConnection.h).toBe(before);
  });

  it('does not store a forced fetch of the file it already has', async () => {
    const h = host({ mtime: 10, text: WARM });
    await checkHostTheme('h', h.transport);
    const before = useHostTheme.getState().byConnection.h;
    await checkHostTheme('h', h.transport, { force: true });
    expect(h.commands.at(-1)).toContain('"-"');
    expect(useHostTheme.getState().byConnection.h).toBe(before);
  });

  it('shares one round-trip between two checks at once', async () => {
    const h = host(null);
    await Promise.all([checkHostTheme('h', h.transport), checkHostTheme('h', h.transport)]);
    expect(h.commands.filter((command) => command.includes(THEME_BEGIN))).toHaveLength(1);
  });

  it('drops the answer of a check for a host removed while it ran', async () => {
    const h = host({ mtime: 10, text: WARM });
    const check = checkHostTheme('h', h.transport);
    useHostTheme.getState().clear('h');
    await check;
    expect(useHostTheme.getState().byConnection.h).toBeUndefined();
  });
});

describe('Reload and Reset on the Demo host', () => {
  beforeEach(() => useConnections.getState().setAll([], DEMO_CONNECTION_ID));

  it('reloads to the default theme and leaves the reference files behind', async () => {
    expect(await reloadHostTheme(DEMO_CONNECTION_ID)).toBe(true);
    expect(useHostTheme.getState().byConnection[DEMO_CONNECTION_ID]?.status).toBe('missing');
    const demo = clientFor(demoConnection()).transport as DemoHost;
    for (const name of [THEME_SCHEMA_FILE, THEME_README_FILE, THEME_EXAMPLE_FILE]) {
      expect(demo.hostFile(name)).not.toBeNull();
    }
  });

  it('resets, and says false for a host it does not know', async () => {
    expect(await resetHostThemeToDefault(DEMO_CONNECTION_ID)).toBe(true);
    expect(useHostTheme.getState().byConnection[DEMO_CONNECTION_ID]?.status).toBe('missing');
    expect(await reloadHostTheme('nobody')).toBe(false);
    expect(await resetHostThemeToDefault('nobody')).toBe(false);
  });
});
