import type { SQLiteDatabase } from 'expo-sqlite';
import { clearCachedMessages, clearConnectionSettings, clearPrompts, deleteConnection, hostMachinesKey, inTransaction, loadChatPrefs, saveChatPref } from '../db';

it('clears all transcript content, including list previews, but leaves credentials and host rows alone', async () => {
  const runAsync = jest.fn(async () => undefined);
  const db = {
    runAsync,
    withTransactionAsync: async (action: () => Promise<void>) => action(),
  } as unknown as SQLiteDatabase;
  await clearCachedMessages(db);
  expect(runAsync.mock.calls).toEqual([
    ['DELETE FROM messages'], ['DELETE FROM tail_cursors'], ['DELETE FROM previews'],
  ]);
  await clearPrompts(db, 'host');
  expect(runAsync).toHaveBeenLastCalledWith('DELETE FROM prompts WHERE connection_id = ?', 'host');
});

// #92: expo-sqlite's transactions share one connection and are not exclusive.
// Two at once nested BEGINs, and one's ROLLBACK undid the other's writes.
it('runs cache transactions one at a time, and a failure does not stall the rest', async () => {
  let active = 0;
  let most = 0;
  const order: string[] = [];
  const db = {
    withTransactionAsync: async (task: () => Promise<void>) => {
      active += 1;
      most = Math.max(most, active);
      try {
        await task();
      } finally {
        active -= 1;
      }
    },
  } as unknown as SQLiteDatabase;
  const step = (name: string) => async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    order.push(name);
  };
  const failing = inTransaction(db, async () => {
    order.push('fails');
    throw new Error('constraint');
  });
  await Promise.all([
    inTransaction(db, step('a')),
    failing.catch(() => undefined),
    inTransaction(db, step('b')),
  ]);
  await expect(failing).rejects.toThrow('constraint');
  expect(most).toBe(1);
  // In the order they were asked for: the failing one was queued first.
  expect(order).toEqual(['fails', 'a', 'b']);
});

describe('pinned and muted chats', () => {
  const fake = (rows: Record<string, unknown>[]) => {
    const runAsync = jest.fn(async () => undefined);
    const db = { runAsync, getAllAsync: jest.fn(async () => rows) } as unknown as SQLiteDatabase;
    return { db, runAsync };
  };

  it('keeps the other choice when the same chat is muted after being pinned', async () => {
    const { db, runAsync } = fake([{ workspace_id: 'w1', session_sig: 's1', pinned_at: 5, muted: 0 }]);
    await saveChatPref(db, 'host', 'w1', 's1', { muted: true });
    expect(runAsync.mock.calls[0]?.slice(1)).toEqual(['host', 'w1', 's1', 5, 1]);
  });

  // herdr reused the slot: the old chat's pin is not the new chat's.
  it('drops what an earlier chat in the slot chose', async () => {
    const { db, runAsync } = fake([{ workspace_id: 'w1', session_sig: 'old', pinned_at: 5, muted: 1 }]);
    await saveChatPref(db, 'host', 'w1', 'new', { muted: true });
    expect(runAsync.mock.calls[0]?.slice(1)).toEqual(['host', 'w1', 'new', null, 1]);
  });

  it('deletes the row once neither choice is left', async () => {
    const { db, runAsync } = fake([{ workspace_id: 'w1', session_sig: 's1', pinned_at: 5, muted: 0 }]);
    await saveChatPref(db, 'host', 'w1', 's1', { pinnedAt: null });
    expect(runAsync).toHaveBeenCalledWith('DELETE FROM chat_prefs WHERE connection_id = ? AND workspace_id = ?', 'host', 'w1');
    const loaded = await loadChatPrefs(db, 'host');
    expect(loaded.get('w1')).toEqual({ sessionSig: 's1', pinnedAt: 5, muted: false });
  });
});

// MARK: - A host's machines go with it

/**
 * A real SQLite, from Node's own `node:sqlite`, so the DELETEs are run rather
 * than read (as in threadCache.test). Absent on a Node without it, where the
 * tests say so instead of passing on nothing.
 */
type Sqlite = { DatabaseSync: new (path: string) => {
  exec: (sql: string) => void;
  prepare: (sql: string) => { run: (...params: unknown[]) => unknown; all: (...params: unknown[]) => unknown[] };
} };
function loadSqlite(): Sqlite | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional at runtime; an import would fail the suite on Node without it.
    return require('node:sqlite') as Sqlite;
  } catch {
    return null;
  }
}
const sqlite = loadSqlite();
const itWithSqlite = sqlite === null ? it.skip : it;

function realDb() {
  const raw = new sqlite!.DatabaseSync(':memory:');
  const db = {
    runAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).run(...params),
    withTransactionAsync: async (task: () => Promise<void>) => task(),
  } as unknown as SQLiteDatabase;
  return { raw, db };
}

// A machine's chats are filed under `<host>/<machine>`. Removing the host left
// them behind, and a host re-added under the same id opened its machines on
// the removed one's history.
itWithSqlite('deletes a host\'s rows and its machines\' rows, and nothing of its neighbours', async () => {
  const { raw, db } = realDb();
  const tables = ['messages', 'tail_cursors', 'previews', 'thread_reads', 'chat_prefs', 'prompts'];
  raw.exec('CREATE TABLE connections (id TEXT)');
  for (const table of tables) raw.exec(`CREATE TABLE ${table} (connection_id TEXT)`);
  const ids = ['h1', 'h1/m1', 'h1/m2', 'h10', 'h10/m1', 'h_', 'x/h1'];
  for (const id of ids) {
    raw.prepare('INSERT INTO connections VALUES (?)').run(id);
    for (const table of tables) raw.prepare(`INSERT INTO ${table} VALUES (?)`).run(id);
  }
  await deleteConnection(db, 'h1');
  // An `_` in an id is a character, not LIKE's any-one-character.
  await deleteConnection(db, 'h_');
  for (const table of tables) {
    const left = raw.prepare(`SELECT connection_id AS id FROM ${table} ORDER BY id`).all() as { id: string }[];
    expect(left.map((row) => row.id)).toEqual(['h10', 'h10/m1', 'x/h1']);
  }
});

itWithSqlite('clears a host\'s settings and its machines\', and nothing of its neighbours', async () => {
  const { raw, db } = realDb();
  raw.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  const keys = [
    hostMachinesKey('h1'),
    'lastCwd.h1',
    'lastCwd.h1/m1',
    'notifyMode.h1/m2',
    hostMachinesKey('h10'),
    'lastCwd.h10/m1',
    'lastCwd.xh1/m1',
    'h1/m1',
    'theme',
  ];
  for (const key of keys) raw.prepare('INSERT INTO settings VALUES (?, ?)').run(key, 'x');
  await clearConnectionSettings(db, 'h1');
  const left = raw.prepare('SELECT key FROM settings ORDER BY key').all() as { key: string }[];
  // `h1/m1` alone is no host's setting: settings are `<name>.<id>`.
  expect(left.map((row) => row.key)).toEqual(['h1/m1', 'hostMachines.h10', 'lastCwd.h10/m1', 'lastCwd.xh1/m1', 'theme']);
});
