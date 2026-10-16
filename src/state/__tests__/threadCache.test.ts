import type { SQLiteDatabase } from 'expo-sqlite';

import { cacheStamp } from '@/lib/transcript/cacheVersion';
import { appendMessages, clearThreadCache, forgetWorkspace, MAX_CACHED_MESSAGES, rebind, seedIfSession, seedMessages } from '../threadCache';

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

const TABLES = ['messages', 'tail_cursors', 'thread_reads', 'chat_prefs'];

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

// A row an older parser made is dropped, with its tail cursor, so the
// transcript is read again rather than shown as it was parsed then.
itWithSqlite('drops rows an older parser cached, and keeps its own', async () => {
  const raw = new sqlite!.DatabaseSync(':memory:');
  raw.exec('CREATE TABLE messages (connection_id TEXT, workspace_id TEXT, session_sig TEXT)');
  raw.exec('CREATE TABLE tail_cursors (connection_id TEXT, workspace_id TEXT)');
  raw.prepare('INSERT INTO messages VALUES (?, ?, ?)').run('host', 'w1', 'sess-a');
  raw.prepare('INSERT INTO messages VALUES (?, ?, ?)').run('host', 'w2', cacheStamp('sess-a'));
  for (const workspace of ['w1', 'w2']) raw.prepare('INSERT INTO tail_cursors VALUES (?, ?)').run('host', workspace);
  const db = {
    runAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).run(...params),
    getFirstAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).all(...params)[0] ?? null,
    withTransactionAsync: async (task: () => Promise<void>) => task(),
  } as unknown as SQLiteDatabase;

  expect(await rebind(db, 'host', 'w1', 'sess-a')).toBe(true);
  expect(await rebind(db, 'host', 'w2', 'sess-a')).toBe(false);
  for (const table of ['messages', 'tail_cursors']) {
    const left = raw.prepare(`SELECT workspace_id AS w FROM ${table}`).all() as { w: string }[];
    expect(left.map((row) => row.w)).toEqual(['w2']);
  }
});

// The cache only grew: every line of every session, for as long as the chat
// was open, while a reopen reads the newest 150.
itWithSqlite('keeps a chat cache to its newest messages as it appends', async () => {
  const raw = new sqlite!.DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE messages (connection_id TEXT NOT NULL, workspace_id TEXT NOT NULL, session_sig TEXT NOT NULL,
    message_id TEXT NOT NULL, seq INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (connection_id, workspace_id, message_id))`);
  const db = {
    runAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).run(...params),
    getFirstAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).all(...params)[0] ?? null,
    getAllAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).all(...params),
    prepareAsync: async (sql: string) => {
      const statement = raw.prepare(sql);
      return { executeAsync: async (...params: unknown[]) => statement.run(...params), finalizeAsync: async () => undefined };
    },
    withTransactionAsync: async (task: () => Promise<void>) => task(),
  } as unknown as SQLiteDatabase;
  const message = (id: number) => ({
    id: `m${id}`, role: 'assistant' as const, segments: [{ kind: 'text' as const, text: `${id}` }],
    timestamp: id, agentLabel: null, isSidechain: false,
  });
  for (let batch = 0; batch < 7; batch += 1) {
    await appendMessages(db, 'host', 'w1', 'sig', Array.from({ length: 100 }, (_, index) => message(batch * 100 + index)));
  }
  const rows = raw.prepare('SELECT COUNT(*) AS n, MIN(seq) AS low FROM messages').all()[0] as { n: number; low: number };
  expect(rows).toEqual({ n: MAX_CACHED_MESSAGES, low: 700 - MAX_CACHED_MESSAGES });
  expect((await seedMessages(db, 'host', 'w1')).at(-1)?.id).toBe('m699');
});

// What a chat shows the moment it opens: its cache, but only when the cache is
// the session the list saw, and never deleting a cache it does not show.
itWithSqlite("seeds only the listed session's cache, and deletes nothing either way", async () => {
  const raw = new sqlite!.DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE messages (connection_id TEXT NOT NULL, workspace_id TEXT NOT NULL, session_sig TEXT NOT NULL,
    message_id TEXT NOT NULL, seq INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (connection_id, workspace_id, message_id))`);
  const message = { id: 'm1', role: 'assistant', segments: [{ kind: 'text', text: 'hi' }], timestamp: 1, agentLabel: null, isSidechain: false };
  raw.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)').run('host', 'w1', cacheStamp('sess-a'), 'm1', 0, JSON.stringify(message));
  const db = {
    getFirstAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).all(...params)[0] ?? null,
    getAllAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).all(...params),
  } as unknown as SQLiteDatabase;
  expect((await seedIfSession(db, 'host', 'w1', 'sess-a')).map((cached) => cached.id)).toEqual(['m1']);
  expect(await seedIfSession(db, 'host', 'w1', 'sess-b')).toEqual([]);
  expect(raw.prepare('SELECT COUNT(*) AS n FROM messages').all()[0]).toEqual({ n: 1 });
});

// A reload starts the chat from the host again: its messages and its cursors
// go, and nothing of another chat's.
itWithSqlite("clears one chat's messages and cursors for a reload, and nothing else", async () => {
  const raw = new sqlite!.DatabaseSync(':memory:');
  for (const table of ['messages', 'tail_cursors']) raw.exec(`CREATE TABLE ${table} (connection_id TEXT, workspace_id TEXT)`);
  for (const table of ['messages', 'tail_cursors']) {
    for (const key of ['w1', 'w2']) raw.prepare(`INSERT INTO ${table} VALUES (?, ?)`).run('host', key);
  }
  const db = {
    runAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).run(...params),
    withTransactionAsync: async (task: () => Promise<void>) => task(),
  } as unknown as SQLiteDatabase;
  await clearThreadCache(db, 'host', 'w1');
  for (const table of ['messages', 'tail_cursors']) {
    expect(raw.prepare(`SELECT workspace_id FROM ${table}`).all()).toEqual([{ workspace_id: 'w2' }]);
  }
});

// Gemini CLI writes a message again once its tool results are in. Kept as
// first cached, a reopen showed the call without its result.
itWithSqlite('replaces a message cached again under its id, and keeps its place', async () => {
  const raw = new sqlite!.DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE messages (connection_id TEXT NOT NULL, workspace_id TEXT NOT NULL, session_sig TEXT NOT NULL,
    message_id TEXT NOT NULL, seq INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (connection_id, workspace_id, message_id))`);
  const db = {
    runAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).run(...params),
    getFirstAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).all(...params)[0] ?? null,
    getAllAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).all(...params),
    prepareAsync: async (sql: string) => {
      const statement = raw.prepare(sql);
      return { executeAsync: async (...params: unknown[]) => statement.run(...params), finalizeAsync: async () => undefined };
    },
    withTransactionAsync: async (task: () => Promise<void>) => task(),
  } as unknown as SQLiteDatabase;
  const message = (id: string, text: string) => ({
    id, role: 'assistant' as const, segments: [{ kind: 'text' as const, text }], timestamp: 1, agentLabel: null, isSidechain: false,
  });
  await appendMessages(db, 'host', 'w1', 'sig', [message('a', 'running'), message('b', 'next')]);
  await appendMessages(db, 'host', 'w1', 'sig', [message('a', 'ran it'), message('c', 'last')]);
  expect((await seedMessages(db, 'host', 'w1')).map((cached) => [cached.id, cached.segments[0]])).toEqual([
    ['a', { kind: 'text', text: 'ran it' }],
    ['b', { kind: 'text', text: 'next' }],
    ['c', { kind: 'text', text: 'last' }],
  ]);
});
