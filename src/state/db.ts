import * as SQLite from 'expo-sqlite';

import type { ThreadRead } from '@/lib/unread';
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

    -- When each thread was last opened. Unread is DERIVED from this against the
    -- preview (see src/lib/unread.ts) rather than stored as a flag, so there is
    -- no second source of truth to fall out of step.
    --
    -- session_sig for the same reason previews carries one: a workspace id is a
    -- slot herdr reuses, and without it a new chat would inherit the previous
    -- chat's read marker and never announce its first message.
    CREATE TABLE IF NOT EXISTS thread_reads (
      connection_id TEXT NOT NULL,
      workspace_id  TEXT NOT NULL,
      session_sig   TEXT NOT NULL,
      opened_at     INTEGER NOT NULL,
      PRIMARY KEY (connection_id, workspace_id)
    );

    -- Prompts sent from this device, newest first, so they can be re-sent
    -- without retyping. Scoped per connection because the useful prompts are
    -- host-specific — "run the tests" means a different thing on each machine.
    --
    -- Deliberately not synced with anything and trimmed to a small cap: this is
    -- a convenience, not a record, and it holds whatever the user typed.
    CREATE TABLE IF NOT EXISTS prompts (
      connection_id TEXT NOT NULL,
      text          TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      PRIMARY KEY (connection_id, text)
    );

    -- Superseded by thread_reads. Safe to drop unconditionally: the old table
    -- had no session_sig and nothing ever wrote to it, so there is no state to
    -- migrate. Named differently on purpose, so this DROP cannot delete the new
    -- one on a later launch.
    DROP TABLE IF EXISTS unread;
  `);

  await addColumnIfMissing(db, 'connections', 'session_name', "TEXT NOT NULL DEFAULT ''");
}

/**
 * `ALTER TABLE … ADD COLUMN`, made idempotent.
 *
 * Everything above is `CREATE TABLE IF NOT EXISTS`, which re-runs harmlessly on
 * every launch. `ADD COLUMN` has no such form — it throws once the column is
 * there — and this schema has no version counter to hang a one-shot migration
 * off. Asking the table what it already has is cheaper than introducing one, and
 * cannot drift from reality the way a version number can.
 */
async function addColumnIfMissing(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (columns.some((existing) => existing.name === column)) return;
  await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
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
  session_name: string | null;
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
    // Null on a row written before the column existed.
    sessionName: row.session_name ?? '',
  }));
}

export async function saveConnection(
  db: SQLite.SQLiteDatabase,
  connection: ServerConnection
): Promise<void> {
  await db.runAsync(
    `INSERT INTO connections (id, name, host, port, username, auth_kind, herdr_path, session_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, host = excluded.host, port = excluded.port,
       username = excluded.username, auth_kind = excluded.auth_kind,
       herdr_path = excluded.herdr_path, session_name = excluded.session_name`,
    connection.id,
    connection.name,
    connection.host,
    connection.port,
    connection.username,
    connection.authKind,
    connection.herdrPath,
    connection.sessionName
  );
}

export async function deleteConnection(db: SQLite.SQLiteDatabase, id: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM connections WHERE id = ?', id);
    await db.runAsync('DELETE FROM messages WHERE connection_id = ?', id);
    await db.runAsync('DELETE FROM tail_cursors WHERE connection_id = ?', id);
    await db.runAsync('DELETE FROM previews WHERE connection_id = ?', id);
    await db.runAsync('DELETE FROM thread_reads WHERE connection_id = ?', id);
    // The user's own words, typed on a host they just removed. Leaving them
    // behind also let a re-added host inherit another host's prompt history,
    // because connection ids are reused from the row that made them.
    await db.runAsync('DELETE FROM prompts WHERE connection_id = ?', id);
  });
}

// MARK: - Read markers

/**
 * Record that this thread was just opened, so the chat list stops showing it as
 * unread. Keyed per workspace but stamped with the session, so re-opening a
 * recycled workspace overwrites the previous chat's marker rather than being
 * silenced by it.
 */
export async function markThreadRead(
  db: SQLite.SQLiteDatabase,
  connectionId: string,
  workspaceId: string,
  sessionSig: string,
  openedAt: number
): Promise<void> {
  await db.runAsync(
    `INSERT INTO thread_reads (connection_id, workspace_id, session_sig, opened_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (connection_id, workspace_id)
     DO UPDATE SET session_sig = excluded.session_sig, opened_at = excluded.opened_at`,
    connectionId,
    workspaceId,
    sessionSig,
    openedAt
  );
}

/** Every read marker for one server, for the chat list to compare against. */
export async function loadThreadReads(
  db: SQLite.SQLiteDatabase,
  connectionId: string
): Promise<Map<string, ThreadRead>> {
  const rows = await db.getAllAsync<{
    workspace_id: string;
    session_sig: string;
    opened_at: number;
  }>(
    'SELECT workspace_id, session_sig, opened_at FROM thread_reads WHERE connection_id = ?',
    connectionId
  );
  return new Map(
    rows.map((row) => [row.workspace_id, { sessionSig: row.session_sig, openedAt: row.opened_at }])
  );
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

// MARK: - Prompt history
//
// Typing on a phone is far more expensive than typing at a desk, and the same
// handful of instructions come up over and over — "run the tests", "commit and
// push", "keep going". Re-sending one should not mean retyping it.

/** How many prompts to keep per host. Enough to find one, few enough to scan. */
const PROMPT_HISTORY_LIMIT = 20;

/**
 * Record a prompt, newest first.
 *
 * Re-sending an identical prompt moves it back to the top rather than adding a
 * duplicate — the primary key does the deduplication and `created_at` does the
 * ordering, so a favourite instruction stays reachable instead of being pushed
 * out by its own repetitions.
 */
export async function rememberPrompt(
  db: SQLite.SQLiteDatabase,
  connectionId: string,
  text: string
): Promise<void> {
  const trimmed = text.trim();
  // Multi-line prompts are real, but a whole pasted file is not a shortcut.
  if (trimmed.length === 0 || trimmed.length > 2_000) return;

  await db.runAsync(
    `INSERT INTO prompts (connection_id, text, created_at) VALUES (?, ?, ?)
     ON CONFLICT(connection_id, text) DO UPDATE SET created_at = excluded.created_at`,
    connectionId,
    trimmed,
    Date.now()
  );
  await db.runAsync(
    `DELETE FROM prompts WHERE connection_id = ? AND text NOT IN (
       SELECT text FROM prompts WHERE connection_id = ? ORDER BY created_at DESC LIMIT ?
     )`,
    connectionId,
    connectionId,
    PROMPT_HISTORY_LIMIT
  );
}

export async function recentPrompts(
  db: SQLite.SQLiteDatabase,
  connectionId: string
): Promise<string[]> {
  const rows = await db.getAllAsync<{ text: string }>(
    `SELECT text FROM prompts WHERE connection_id = ? ORDER BY created_at DESC LIMIT ?`,
    connectionId,
    PROMPT_HISTORY_LIMIT
  );
  return rows.map((row) => row.text);
}

/** Forget everything typed on this host. Offered because it is the user's own words. */
export async function clearPrompts(
  db: SQLite.SQLiteDatabase,
  connectionId: string
): Promise<void> {
  await db.runAsync(`DELETE FROM prompts WHERE connection_id = ?`, connectionId);
}
