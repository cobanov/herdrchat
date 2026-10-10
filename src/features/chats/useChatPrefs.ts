import type * as SQLite from 'expo-sqlite';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { publishMutedChats } from '@/features/notifications/mutedChats';
import { activePref, type ChatPref } from '@/lib/chatPrefs';
import { haptics } from '@/lib/haptics';
import type { ServerConnection } from '@/state/connections';
import { loadChatPrefs, saveChatPref } from '@/state/db';
import { rowKey, type ListedChat } from './listedChat';
import { errorText } from './useWorkspaces';

/**
 * Pinned and muted chats on one host, and the two toggles.
 *
 * Both need the chat's session: a pin or mute belongs to a conversation, and
 * herdr hands its workspace slot to the next one (see `chatPrefs`). A chat
 * whose agent has not reported a session yet offers neither.
 *
 * The list also holds the chats of the host's machines, whose workspace ids
 * repeat the host's, so prefs are loaded and saved under each row's own
 * connection and `pinnedAt` is filed by `rowKey`. A machine's chat can be
 * pinned and not muted: muting is something the host's notifier is told, and
 * it does not watch its machines' sessions.
 */
export function useChatPrefs(
  db: SQLite.SQLiteDatabase,
  connection: ServerConnection | null,
  summaries: readonly ListedChat[],
  /** The host's id and its machines': whose prefs to load. */
  connectionIds: readonly string[] = connection === null ? [] : [connection.id]
): {
  pinnedAt: ReadonlyMap<string, number>;
  isPinned: (summary: ListedChat) => boolean;
  isMuted: (summary: ListedChat) => boolean;
  /** Whether muting means anything for this row: only the host's own chats notify. */
  canMute: (summary: ListedChat) => boolean;
  togglePin: (summary: ListedChat) => void;
  toggleMute: (summary: ListedChat) => void;
  /** A mute saved here that could not reach the host. */
  error: string | null;
  clearError: () => void;
} {
  const [prefs, setPrefs] = useState<ReadonlyMap<string, ReadonlyMap<string, ChatPref>>>(new Map());
  const [error, setError] = useState<string | null>(null);
  // A string, so a list rebuilt with the same ids does not reload.
  const idsKey = connectionIds.join('\n');

  const reload = useCallback(async () => {
    if (idsKey === '') return;
    setPrefs(await loadAll(db, idsKey.split('\n')));
  }, [db, idsKey]);

  // On a host switch, and on coming back to the list (the iPad sidebar stays
  // focused, which is why both).
  useEffect(() => {
    if (idsKey === '') return;
    let alive = true;
    void loadAll(db, idsKey.split('\n')).then((next) => {
      if (alive) setPrefs(next);
    });
    return () => {
      alive = false;
    };
  }, [db, idsKey]);
  useFocusEffect(useCallback(() => void reload(), [reload]));

  const prefFor = useCallback(
    (summary: ListedChat) =>
      activePref(prefs.get(summary.connectionId) ?? NO_PREFS, summary.workspaceId, summary.sessionSig),
    [prefs]
  );

  const pinnedAt = useMemo(() => {
    const order = new Map<string, number>();
    for (const summary of summaries) {
      const at = prefFor(summary)?.pinnedAt;
      if (at !== undefined && at !== null) order.set(rowKey(summary), at);
    }
    return order;
  }, [summaries, prefFor]);

  const togglePin = useCallback(
    (summary: ListedChat) => {
      if (summary.sessionSig === null) return;
      haptics.selection();
      const pinned = (prefFor(summary)?.pinnedAt ?? null) !== null;
      void saveChatPref(db, summary.connectionId, summary.workspaceId, summary.sessionSig, {
        pinnedAt: pinned ? null : Date.now(),
      }).then(reload);
    },
    [db, prefFor, reload]
  );

  const canMute = useCallback(
    (summary: ListedChat) => connection !== null && summary.connectionId === connection.id,
    [connection]
  );

  const toggleMute = useCallback(
    (summary: ListedChat) => {
      if (connection === null || summary.sessionSig === null || !canMute(summary)) return;
      haptics.selection();
      const muted = prefFor(summary)?.muted ?? false;
      void saveChatPref(db, connection.id, summary.workspaceId, summary.sessionSig, { muted: !muted })
        .then(reload)
        .then(() => publishMutedChats(db, connection))
        .catch((thrown: unknown) => setError(`Couldn't update notifications on ${connection.name}. ${errorText(thrown)}`));
    },
    [db, connection, canMute, prefFor, reload]
  );

  return {
    pinnedAt,
    isPinned: (summary) => (prefFor(summary)?.pinnedAt ?? null) !== null,
    isMuted: (summary) => canMute(summary) && (prefFor(summary)?.muted ?? false),
    canMute,
    togglePin,
    toggleMute,
    error,
    clearError: useCallback(() => setError(null), []),
  };
}

const NO_PREFS: ReadonlyMap<string, ChatPref> = new Map();

async function loadAll(
  db: SQLite.SQLiteDatabase,
  connectionIds: readonly string[]
): Promise<Map<string, ReadonlyMap<string, ChatPref>>> {
  const loaded = await Promise.all(connectionIds.map(async (id) => [id, await loadChatPrefs(db, id)] as const));
  return new Map(loaded);
}
