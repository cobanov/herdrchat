import type { SQLiteDatabase } from 'expo-sqlite';

import { HerdrError } from '@/lib/herdr/protocol';
import { parseMachineList, type HostMachine, type MachineList } from '@/lib/herdr/machines';
import { hostMachinesKey } from '../db';
import {
  enabledMachines,
  findEnabledMachine,
  loadHostMachines,
  mirrorHostMachines,
  refreshHostMachines,
  resetHostMachinesSession,
  serializeMachines,
  useHostMachines,
} from '../hostMachines';
import { clearHostSettings } from '../hostTheme';
import { draftKey, useDrafts } from '../drafts';

jest.mock('@/state/sshTransport', () => ({ SshHerdrTransport: class {} }));

const klaw: HostMachine = { id: 'm-klaw', label: 'klaw', target: 'klaw', session: 'default', enabled: true };
const nuku: HostMachine = { id: 'm-nuku', label: 'nuku', target: 'nuku', session: 'work', enabled: false };

/** The settings table, in memory, answering the statements this store uses. */
function fakeDb(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  const db = {
    getAllAsync: async (_sql: string, prefix: string) =>
      [...rows].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })),
    runAsync: async (sql: string, key: string, value?: string) => {
      if (sql.startsWith('INSERT INTO settings')) rows.set(key, value!);
      else if (sql.startsWith('DELETE FROM settings WHERE key = ?')) rows.delete(key);
      else if (sql.startsWith('DELETE FROM settings WHERE (length(key)')) {
        for (const stored of [...rows.keys()]) if (stored.endsWith(key) || stored.indexOf(`${key}/`) > 0) rows.delete(stored);
      } else throw new Error(`unexpected ${sql}`);
    },
  } as unknown as SQLiteDatabase;
  return { db, rows };
}

const answering = (machines: HostMachine[]) => ({
  machines: jest.fn(async (): Promise<MachineList> => ({ machines, skipped: [], unreadIds: [], complete: true })),
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => resetHostMachinesSession());

describe('the machine list store', () => {
  it('shows only enabled machines, and keeps the disabled ones', () => {
    useHostMachines.getState().set('h1', [klaw, nuku]);
    const { byHost } = useHostMachines.getState();
    expect(byHost.h1).toEqual([klaw, nuku]);
    expect(enabledMachines(byHost, 'h1')).toEqual([klaw]);
    expect(enabledMachines(byHost, 'never-asked')).toEqual([]);
    expect(findEnabledMachine(byHost, 'h1', 'm-klaw')).toBe(klaw);
    expect(findEnabledMachine(byHost, 'h1', 'm-nuku')).toBeNull();
    expect(findEnabledMachine(byHost, 'h1', 'gone')).toBeNull();
  });

  // The poll parses a fresh list every minute. New objects for the same
  // machines would hand every open machine thread a "new" connection.
  it('keeps the same objects for an unchanged list, and for each unchanged machine', () => {
    useHostMachines.getState().set('h1', [klaw, nuku]);
    const before = useHostMachines.getState().byHost;
    useHostMachines.getState().set('h1', [{ ...klaw }, { ...nuku }]);
    expect(useHostMachines.getState().byHost).toBe(before);
    useHostMachines.getState().set('h1', [{ ...klaw }, { ...nuku, enabled: true }]);
    const after = useHostMachines.getState().byHost.h1;
    expect(after?.[0]).toBe(klaw);
    expect(after?.[1]).toEqual({ ...nuku, enabled: true });
  });
});

describe('refreshHostMachines', () => {
  it('stores what the host lists, including an empty list', async () => {
    expect(await refreshHostMachines('h1', answering([klaw]))).toBe(true);
    expect(useHostMachines.getState().byHost.h1).toEqual([klaw]);
    expect(await refreshHostMachines('h1', answering([]))).toBe(true);
    expect(useHostMachines.getState().byHost.h1).toEqual([]);
  });

  it('keeps the last list when the host does not answer, and never rejects', async () => {
    useHostMachines.getState().set('h1', [klaw]);
    const failing = { machines: jest.fn(async () => Promise.reject(new HerdrError('connect_failed', 'down'))) };
    await expect(refreshHostMachines('h1', failing)).resolves.toBe(false);
    expect(useHostMachines.getState().byHost.h1).toEqual([klaw]);
  });

  it('shares one round-trip between two callers', async () => {
    const client = answering([klaw]);
    await Promise.all([refreshHostMachines('h1', client), refreshHostMachines('h1', client)]);
    expect(client.machines).toHaveBeenCalledTimes(1);
  });

  // A removed host's list must not come back from an answer already on its way.
  it('drops an answer for a host cleared while it was asked', async () => {
    let answer: (list: MachineList) => void = () => undefined;
    const slow = { machines: () => new Promise<MachineList>((resolve) => { answer = resolve; }) };
    const asked = refreshHostMachines('h1', slow);
    useHostMachines.getState().clear('h1');
    answer({ machines: [klaw], skipped: [], unreadIds: [], complete: true });
    await asked;
    expect(useHostMachines.getState().byHost.h1).toBeUndefined();
  });
});

describe('persistence', () => {
  it('loads the cached lists at launch, through the host answer\'s own parser', async () => {
    const { db } = fakeDb({
      [hostMachinesKey('h1')]: serializeMachines([klaw, nuku]),
      [hostMachinesKey('h2')]: 'not json',
      [hostMachinesKey('h3')]: JSON.stringify([{ id: 'a/b', target: 'x' }, { id: 'ok', target: 'ok' }]),
    });
    await loadHostMachines(db);
    const { byHost } = useHostMachines.getState();
    expect(byHost.h1).toEqual([klaw, nuku]);
    expect(byHost.h2).toBeUndefined();
    expect(byHost.h3?.map((machine) => machine.id)).toEqual(['ok']);
  });

  it('keeps what the host said when the cache loads after it', async () => {
    const { db } = fakeDb({ [hostMachinesKey('h1')]: serializeMachines([klaw]) });
    useHostMachines.getState().set('h1', []);
    await loadHostMachines(db);
    expect(useHostMachines.getState().byHost.h1).toEqual([]);
  });

  it('writes each change back, but not the launch\'s own load', async () => {
    const { db, rows } = fakeDb({ [hostMachinesKey('h1')]: serializeMachines([klaw]) });
    const stop = mirrorHostMachines(db);
    const written = jest.spyOn(db, 'runAsync');
    await loadHostMachines(db);
    expect(written).not.toHaveBeenCalled();
    useHostMachines.getState().set('h2', [nuku]);
    await flush();
    expect(rows.get(hostMachinesKey('h2'))).toBe(serializeMachines([nuku]));
    useHostMachines.getState().clear('h1');
    await flush();
    expect(rows.has(hostMachinesKey('h1'))).toBe(false);
    stop();
  });

  // Removing a host left its machine chats listed, and resolvable, until the
  // next launch, and its machines' settings in the table for good.
  it('forgets a host\'s machines, in memory and in the table, with its other settings', async () => {
    const { db, rows } = fakeDb({
      [hostMachinesKey('h1')]: serializeMachines([klaw]),
      [hostMachinesKey('h10')]: serializeMachines([klaw]),
      'lastCwd.h1/m-klaw': '/home',
    });
    useHostMachines.getState().set('h1', [klaw]);
    useHostMachines.getState().set('h10', [klaw]);
    await clearHostSettings(db, 'h1');
    expect(Object.keys(useHostMachines.getState().byHost)).toEqual(['h10']);
    expect([...rows.keys()]).toEqual([hostMachinesKey('h10')]);
  });
});

// #159 review: rows for a machine the host stopped listing (its cache, read
// markers, pins, prompts, settings, drafts) went only with the host.
describe('a machine the host stops listing', () => {
  function recordingDb() {
    const statements: { sql: string; params: unknown[] }[] = [];
    const db = {
      runAsync: async (sql: string, ...params: unknown[]) => {
        statements.push({ sql, params });
      },
      withTransactionAsync: async (task: () => Promise<void>) => task(),
    } as unknown as SQLiteDatabase;
    /** The connection ids rows were deleted under, per table. */
    const deletedUnder = () =>
      statements
        .filter(({ sql }) => sql.startsWith('DELETE FROM') && !sql.startsWith('DELETE FROM settings'))
        .map(({ sql, params }) => `${/DELETE FROM (\w+)/.exec(sql)?.[1]}:${String(params[0])}`);
    const settingsCleared = () =>
      statements.filter(({ sql }) => sql.startsWith('DELETE FROM settings WHERE (length(key)')).map(({ params }) => params[0]);
    return { db, deletedUnder, settingsCleared };
  }

  it('forgets its rows and drafts, and nothing of the machines still listed or disabled', async () => {
    const { db, deletedUnder, settingsCleared } = recordingDb();
    const gone: HostMachine = { id: 'm-gone', label: 'gone', target: 'gone', session: 'default', enabled: true };
    useHostMachines.getState().set('h1', [klaw, nuku, gone]);
    useDrafts.getState().save(draftKey('h1/m-gone', 'w1'), 'half typed', null);
    useDrafts.getState().save(draftKey('h1/m-klaw', 'w1'), 'keep me', null);
    useDrafts.getState().save(draftKey('h1', 'w1'), 'host draft', null);
    const stop = mirrorHostMachines(db);
    // nuku turned off at the host: still listed, still kept.
    expect(await refreshHostMachines('h1', answering([klaw, { ...nuku, enabled: false }]))).toBe(true);
    await flush();
    stop();
    expect(deletedUnder()).toEqual([
      'connections:h1/m-gone',
      ...['messages', 'tail_cursors', 'thread_reads', 'chat_prefs', 'prompts'].map((table) => `${table}:h1/m-gone`),
    ]);
    expect(settingsCleared()).toEqual(['.h1/m-gone']);
    expect(Object.keys(useDrafts.getState().drafts).sort()).toEqual([draftKey('h1', 'w1'), draftKey('h1/m-klaw', 'w1')].sort());
  });

  it('forgets nothing on a first answer, or on an unchanged one', async () => {
    const { db, deletedUnder } = recordingDb();
    const stop = mirrorHostMachines(db);
    await refreshHostMachines('h1', answering([klaw]));
    await refreshHostMachines('h1', answering([{ ...klaw }]));
    await flush();
    stop();
    expect(deletedUnder()).toEqual([]);
  });

  it('forgets nothing of a machine the host still lists but whose row no longer reads', async () => {
    const { db, deletedUnder } = recordingDb();
    useHostMachines.getState().set('h1', [klaw, nuku]);
    const stop = mirrorHostMachines(db);
    const reshaped = { machines: jest.fn(async () => parseMachineList(JSON.stringify([klaw, { ...nuku, enabled: 'no' }]))) };
    expect(await refreshHostMachines('h1', reshaped)).toBe(true);
    const blank = { machines: jest.fn(async () => parseMachineList('')) };
    expect(await refreshHostMachines('h1', blank)).toBe(true);
    await flush();
    stop();
    expect(deletedUnder()).toEqual([]);
    expect(useHostMachines.getState().byHost.h1).toEqual([klaw, nuku]);
  });
});
