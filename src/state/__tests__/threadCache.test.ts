import type { SQLiteDatabase } from 'expo-sqlite';

import { forgetWorkspace } from '../threadCache';

/**
 * A real SQLite, from Node's own `node:sqlite`, behind the few calls the cache
 * makes, so the DELETE is run rather than read. Absent on a Node without it,
 * where the test says so instead of passing on nothing.
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

const TABLES = ['messages', 'tail_cursors', 'previews', 'thread_reads', 'chat_prefs'];

// Closing a two-agent workspace left each agent's messages, tail cursor and
// read marker behind under `w6/w6:p1`; herdr recycles w6, and the next
// workspace there opened p1 offline on the closed one's conversation.
itWithSqlite('forgets every agent chat of a closed workspace, and nothing of its neighbours', async () => {
  const raw = new sqlite!.DatabaseSync(':memory:');
  for (const table of TABLES) raw.exec(`CREATE TABLE ${table} (connection_id TEXT, workspace_id TEXT)`);
  const keys = ['w6', 'w6/w6:p1', 'w6/w6:p2', 'w60', 'w60/w60:p1', 'w_', 'wx/w6:p1'];
  for (const table of TABLES) {
    for (const key of keys) raw.prepare(`INSERT INTO ${table} VALUES (?, ?)`).run('host', key);
    raw.prepare(`INSERT INTO ${table} VALUES (?, ?)`).run('other', 'w6/w6:p1');
  }
  const db = {
    runAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).run(...params),
    withTransactionAsync: async (task: () => Promise<void>) => task(),
  } as unknown as SQLiteDatabase;

  await forgetWorkspace(db, 'host', 'w6');
  // An `_` in an id is a character, not LIKE's any-one-character.
  await forgetWorkspace(db, 'host', 'w_');

  for (const table of TABLES) {
    const left = raw.prepare(`SELECT connection_id || ':' || workspace_id AS k FROM ${table} ORDER BY k`).all() as { k: string }[];
    expect(left.map((row) => row.k)).toEqual(['host:w60', 'host:w60/w60:p1', 'host:wx/w6:p1', 'other:w6/w6:p1']);
  }
});
