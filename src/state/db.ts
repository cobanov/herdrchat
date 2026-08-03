import * as SQLite from 'expo-sqlite';

import type { ServerConnection } from './connections';

/**
 * Local persistence. SQLite rather than a key-value blob because the thread
 * cache is genuinely relational — messages belong to a (server, workspace,
 * session) and are queried by recency — and because a blob store forces a
 * read-modify-write of the whole history on every arriving message.
 *
 * `settings` is the key-value corner for the handful of scalars that don't earn
 * a table (last cwd, last permission mode, theme preference).
 */

export const DATABASE_NAME = 'herdrchat.db';

export async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS connections (
      id          TEXT PRIMARY KEY NOT NULL,
      name        TEXT NOT NULL,
      host        TEXT NOT NULL,
      port        INTEGER NOT NULL,
      username    TEXT NOT NULL,
      auth_kind   TEXT NOT NULL,
      herdr_path  TEXT NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    -- One row per rendered bubble. session_sig is what makes a thread's identity
    -- its Claude session rather than its workspace slot: when a workspace is
    -- reused by a new chat the signature changes and the old rows are dropped,
    -- so the previous conversation cannot bleed into the new one.
    CREATE TABLE IF NOT EXISTS messages (
      connection_id TEXT NOT NULL,
      workspace_id  TEXT NOT NULL,
      session_sig   TEXT NOT NULL,
      message_id    TEXT NOT NULL,
      seq           INTEGER NOT NULL,
      payload       TEXT NOT NULL,
      PRIMARY KEY (connection_id, workspace_id, message_id)
    );

    CREATE INDEX IF NOT EXISTS messages_thread_seq
      ON messages (connection_id, workspace_id, seq);

    -- Where the live tail should resume for a given transcript file, so a reopen
    -- costs nothing instead of re-reading the window.
    CREATE TABLE IF NOT EXISTS tail_cursors (
      connection_id TEXT NOT NULL,
      workspace_id  TEXT NOT NULL,
      path          TEXT NOT NULL,
      consumed      INTEGER NOT NULL,
      PRIMARY KEY (connection_id, workspace_id, path)
    );

    -- The chat list's last-message line, kept so rows read correctly on launch
    -- before the first poll lands.
    CREATE TABLE IF NOT EXISTS previews (
      connection_id TEXT NOT NULL,
      workspace_id  TEXT NOT NULL,
      session_sig   TEXT,
      text          TEXT NOT NULL,
      timestamp     INTEGER,
      from_user     INTEGER NOT NULL,
      PRIMARY KEY (connection_id, workspace_id)
    );

    CREATE TABLE IF NOT EXISTS unread (
      connection_id TEXT NOT NULL,
      workspace_id  TEXT NOT NULL,
      PRIMARY KEY (connection_id, workspace_id)
    );
  `);
}

// MARK: - Connections

interface ConnectionRow {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_kind: string;
  herdr_path: string;
}

export async function loadConnections(db: SQLite.SQLiteDatabase): Promise<ServerConnection[]> {
  const rows = await db.getAllAsync<ConnectionRow>(
    'SELECT * FROM connections ORDER BY sort_order, rowid'
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authKind: row.auth_kind === 'password' ? 'password' : 'privateKey',
    herdrPath: row.herdr_path,
  }));
}

export async function saveConnection(
  db: SQLite.SQLiteDatabase,
  connection: ServerConnection
): Promise<void> {
  await db.runAsync(
    `INSERT INTO connections (id, name, host, port, username, auth_kind, herdr_path)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, host = excluded.host, port = excluded.port,
       username = excluded.username, auth_kind = excluded.auth_kind,
       herdr_path = excluded.herdr_path`,
    connection.id,
    connection.name,
    connection.host,
    connection.port,
    connection.username,
    connection.authKind,
    connection.herdrPath
  );
}

export async function deleteConnection(db: SQLite.SQLiteDatabase, id: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM connections WHERE id = ?', id);
    await db.runAsync('DELETE FROM messages WHERE connection_id = ?', id);
    await db.runAsync('DELETE FROM tail_cursors WHERE connection_id = ?', id);
    await db.runAsync('DELETE FROM previews WHERE connection_id = ?', id);
    await db.runAsync('DELETE FROM unread WHERE connection_id = ?', id);
  });
}

// MARK: - Settings

export async function getSetting(
  db: SQLite.SQLiteDatabase,
  key: string
): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    key
  );
  return row?.value ?? null;
}

export async function setSetting(
  db: SQLite.SQLiteDatabase,
  key: string,
  value: string
): Promise<void> {
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value
  );
}

// MARK: - Cache maintenance

/** How many cached bubbles are on disk, across every host. */
export async function cachedMessageCount(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM messages');
  return row?.n ?? 0;
}

/**
 * Drop every cached bubble and tail cursor.
 *
 * Cursors go with the messages: a cursor without its history would make the
 * next tail resume mid-conversation and silently skip everything before it.
 */
export async function clearCachedMessages(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM messages');
    await db.runAsync('DELETE FROM tail_cursors');
  });
}
