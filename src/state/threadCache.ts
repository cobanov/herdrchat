import type * as SQLite from 'expo-sqlite';

import type { ChatMessage } from '@/lib/transcript/message';

/**
 * Disk-backed per-thread message cache, so reopening a chat — even after an app
 * restart — shows history instantly instead of paying an SSH read.
 *
 * The load-bearing idea is `sessionSig`. A chat's identity is its Claude
 * session, not its workspace slot: herdr reuses workspace ids, so without this
 * a new chat started in a recycled workspace would open showing the previous
 * conversation's history. `rebind` is what enforces that.
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

/** Every message id this thread has ever seen, so a tail can't re-add history. */
export async function seenIds(
  db: SQLite.SQLiteDatabase,
  connectionId: string,
  workspaceId: string
): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ message_id: string }>(
    'SELECT message_id FROM messages WHERE connection_id = ? AND workspace_id = ?',
    connectionId,
    workspaceId
  );
  return new Set(rows.map((row) => row.message_id));
}

export async function appendMessages(
  db: SQLite.SQLiteDatabase,
  connectionId: string,
  workspaceId: string,
  sessionSig: string,
  messages: readonly ChatMessage[]
): Promise<void> {
  if (messages.length === 0) return;
  const start = await nextSeq(db, connectionId, workspaceId);
  await db.withTransactionAsync(async () => {
    for (const [offset, message] of messages.entries()) {
      await db.runAsync(
        `INSERT INTO messages (connection_id, workspace_id, session_sig, message_id, seq, payload)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, workspace_id, message_id) DO NOTHING`,
        connectionId,
        workspaceId,
        sessionSig,
        message.id,
        start + offset,
        JSON.stringify(message)
      );
    }
  });
}

/**
 * Point this thread's cache at `sessionSig`, dropping everything cached under a
 * different one.
 *
 * Returns true when history was dropped, so the caller knows to clear its
 * in-memory copy too. A no-op while the session is still unknown — binding to
 * nothing would throw away a perfectly good cache on every cold open.
 */
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
  if (row === null || row.session_sig === sessionSig) return false;

  await db.withTransactionAsync(async () => {
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

export async function resetTailCursor(
  db: SQLite.SQLiteDatabase,
  connectionId: string,
  workspaceId: string,
  path: string
): Promise<void> {
  await db.runAsync(
    'DELETE FROM tail_cursors WHERE connection_id = ? AND workspace_id = ? AND path = ?',
    connectionId,
    workspaceId,
    path
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
