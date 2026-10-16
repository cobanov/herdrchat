import type * as SQLite from 'expo-sqlite';

import { cacheStamp } from '@/lib/transcript/cacheVersion';
import type { ChatMessage } from '@/lib/transcript/message';

import { inTransaction } from './db';

/**
 * Disk-backed per-thread message cache, so reopening a chat — even after an app
 * restart — shows history instantly instead of paying an SSH read.
 *
 * The load-bearing idea is `sessionSig`. A chat's identity is its Claude
 * session, not its workspace slot: herdr reuses workspace ids, so without this
 * a new chat started in a recycled workspace would open showing the previous
 * conversation's history. `rebind` is what enforces that. The stamp also
 * carries the parser's version (`cacheStamp`), so rows an older parser made
 * are dropped and read again rather than shown as they were parsed then.
 */

/** Bubbles to seed on open. More than a chat surface should lay out at once. */
export const SEED_MESSAGE_LIMIT = 150;

export async function seedMessages(
  db: SQLite.SQLiteDatabase,
  connectionId: string,
  workspaceId: string,
  limit = SEED_MESSAGE_LIMIT
): Promise<ChatMessage[]> {
  const rows = await db.getAllAsync<{ payload: string }>(
    `SELECT payload FROM messages
     WHERE connection_id = ? AND workspace_id = ?
     ORDER BY seq DESC LIMIT ?`,
    connectionId,
    workspaceId,
    limit
  );
  // Newest-first for the LIMIT, chronological for the reader.
  return rows
    .reverse()
    .map((row) => safeParse(row.payload))
    .filter((message): message is ChatMessage => message !== null);
}

export async function appendMessages(
  db: SQLite.SQLiteDatabase,
  connectionId: string,
  workspaceId: string,
  sessionSig: string,
  messages: readonly ChatMessage[]
): Promise<void> {
  if (messages.length === 0) return;
  await inTransaction(db, async () => {
    // Read inside the transaction: two appends reading it first both got the
    // same next seq and filed their rows under duplicate numbers (#92).
    const start = await nextSeq(db, connectionId, workspaceId);
    await insertMessages(db, connectionId, workspaceId, sessionSig, messages, start);
    // A reopen reads the newest `SEED_MESSAGE_LIMIT`; the rest only grew, by
    // every line of every session, for as long as the chat was open.
    await db.runAsync(
      'DELETE FROM messages WHERE connection_id = ? AND workspace_id = ? AND seq <= ?',
      connectionId, workspaceId, start + messages.length - 1 - MAX_CACHED_MESSAGES
    );
  });
}

/** How many messages a chat's cache keeps: room above what a reopen reads. */
export const MAX_CACHED_MESSAGES = 500;

/** Replace the cached window only after the new host snapshot was read. */
export async function replaceMessages(
  db: SQLite.SQLiteDatabase,
  connectionId: string,
  workspaceId: string,
  sessionSig: string,
  messages: readonly ChatMessage[]
): Promise<void> {
  await inTransaction(db, async () => {
    await db.runAsync('DELETE FROM messages WHERE connection_id = ? AND workspace_id = ?',
      connectionId, workspaceId);
    await insertMessages(db, connectionId, workspaceId, sessionSig, messages, 0);
  });
}

async function insertMessages(
  db: SQLite.SQLiteDatabase,
  connectionId: string,
  workspaceId: string,
  sessionSig: string,
  messages: readonly ChatMessage[],
  start: number
): Promise<void> {
  if (messages.length === 0) return;
  // One statement for the batch: run as a fresh statement per row, the same
  // insert was compiled again for every message of a window.
  const insert = await db.prepareAsync(
    `INSERT INTO messages (connection_id, workspace_id, session_sig, message_id, seq, payload)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(connection_id, workspace_id, message_id) DO NOTHING`
  );
  try {
    for (const [offset, message] of messages.entries()) {
      await insert.executeAsync(connectionId, workspaceId, cacheStamp(sessionSig), message.id, start + offset, JSON.stringify(message));
    }
  } finally {
    await insert.finalizeAsync();
  }
}

/**
 * Point this thread's cache at `sessionSig`, dropping everything cached under a
 * different one.
 *
 * Returns true when history was dropped, so the caller knows to clear its
 * in-memory copy too. A no-op while the session is still unknown — binding to
 * nothing would throw away a perfectly good cache on every cold open.
 */
/**
 * The cached messages of a chat, but only when they are `sessionSig`'s: what
 * a chat shows the moment it opens, before its first poll. Read only: a cache
 * of another session is left for `rebind` to judge once the host has spoken,
 * never dropped on the word of the list.
 */
export async function seedIfSession(
  db: SQLite.SQLiteDatabase,
  connectionId: string,
  workspaceId: string,
  sessionSig: string
): Promise<ChatMessage[]> {
  const row = await db.getFirstAsync<{ session_sig: string }>(
    'SELECT session_sig FROM messages WHERE connection_id = ? AND workspace_id = ? LIMIT 1',
    connectionId,
    workspaceId
  );
  if (row === null || row.session_sig !== cacheStamp(sessionSig)) return [];
  return seedMessages(db, connectionId, workspaceId);
}

export async function rebind(
  db: SQLite.SQLiteDatabase,
  connectionId: string,
  workspaceId: string,
  sessionSig: string
): Promise<boolean> {
  const row = await db.getFirstAsync<{ session_sig: string }>(
    'SELECT session_sig FROM messages WHERE connection_id = ? AND workspace_id = ? LIMIT 1',
    connectionId,
    workspaceId
  );
  // A row stamped by an older parser is dropped like another session's.
  if (row === null || row.session_sig === cacheStamp(sessionSig)) return false;

  await inTransaction(db, async () => {
    await db.runAsync(
      'DELETE FROM messages WHERE connection_id = ? AND workspace_id = ?',
      connectionId,
      workspaceId
    );
    await db.runAsync(
      'DELETE FROM tail_cursors WHERE connection_id = ? AND workspace_id = ?',
      connectionId,
      workspaceId
    );
  });
  return true;
}

// MARK: - Tail cursors

export async function tailCursor(
  db: SQLite.SQLiteDatabase,
  connectionId: string,
  workspaceId: string,
  path: string
): Promise<number | null> {
  const row = await db.getFirstAsync<{ consumed: number }>(
    'SELECT consumed FROM tail_cursors WHERE connection_id = ? AND workspace_id = ? AND path = ?',
    connectionId,
    workspaceId,
    path
  );
  return row?.consumed ?? null;
}

export async function setTailCursor(
  db: SQLite.SQLiteDatabase,
  connectionId: string,
  workspaceId: string,
  path: string,
  consumed: number
): Promise<void> {
  await db.runAsync(
    `INSERT INTO tail_cursors (connection_id, workspace_id, path, consumed)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(connection_id, workspace_id, path) DO UPDATE SET consumed = excluded.consumed`,
    connectionId,
    workspaceId,
    path,
    consumed
  );
}

// MARK: - Internals

async function nextSeq(
  db: SQLite.SQLiteDatabase,
  connectionId: string,
  workspaceId: string
): Promise<number> {
  const row = await db.getFirstAsync<{ next: number | null }>(
    'SELECT MAX(seq) + 1 AS next FROM messages WHERE connection_id = ? AND workspace_id = ?',
    connectionId,
    workspaceId
  );
  return row?.next ?? 0;
}

function safeParse(payload: string): ChatMessage | null {
  try {
    return JSON.parse(payload) as ChatMessage;
  } catch {
    return null;
  }
}

/**
 * Forget everything cached for one workspace, and for each agent's chat in it.
 *
 * Called when a workspace is closed. herdr recycles workspace ids, so leaving
 * a dead chat's messages behind means the next workspace to land in that slot
 * opens showing them. `rebind` would eventually catch it — that is what the
 * session signature is for — but only once an agent there reports a session
 * id, and the wrong history on screen in the meantime is exactly the bug the
 * signature exists to prevent. Cheaper not to create it.
 */
export async function forgetWorkspace(
  db: SQLite.SQLiteDatabase,
  connectionId: string,
  workspaceId: string
): Promise<void> {
  await inTransaction(db, async () => {
    for (const table of ['messages', 'tail_cursors', 'previews', 'thread_reads', 'chat_prefs']) {
      // The workspace's own rows, and those of each agent in it, which are
      // filed under `w6/<pane>` (see chatKey). By prefix rather than by the
      // panes it has now: one that closed earlier left rows too. `substr`,
      // not LIKE, so an `_` in an id is not a wildcard.
      await db.runAsync(
        `DELETE FROM ${table} WHERE connection_id = ?
         AND (workspace_id = ? OR substr(workspace_id, 1, length(?) + 1) = ? || '/')`,
        connectionId,
        workspaceId,
        workspaceId,
        workspaceId
      );
    }
  });
}
