import type * as SQLite from 'expo-sqlite';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { publishMutedChats } from '@/features/notifications/mutedChats';
import { activePref, type ChatPref } from '@/lib/chatPrefs';
import { haptics } from '@/lib/haptics';
import type { ServerConnection } from '@/state/connections';
import { loadChatPrefs, saveChatPref } from '@/state/db';
import { errorText, type ChatSummary } from './useWorkspaces';

/**
 * Pinned and muted chats on one host, and the two toggles.
 *
 * Both need the chat's session: a pin or mute belongs to a conversation, and
 * herdr hands its workspace slot to the next one (see `chatPrefs`). A chat
 * whose agent has not reported a session yet offers neither.
 */
export function useChatPrefs(
  db: SQLite.SQLiteDatabase,
  connection: ServerConnection | null,
  summaries: readonly ChatSummary[]
): {
  pinnedAt: ReadonlyMap<string, number>;
  isPinned: (summary: ChatSummary) => boolean;
  isMuted: (summary: ChatSummary) => boolean;
  togglePin: (summary: ChatSummary) => void;
  toggleMute: (summary: ChatSummary) => void;
  /** A mute saved here that could not reach the host. */
  error: string | null;
  clearError: () => void;
} {
  const [prefs, setPrefs] = useState<ReadonlyMap<string, ChatPref>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const connectionId = connection?.id ?? null;

  const reload = useCallback(async () => {
    if (connectionId === null) return;
    setPrefs(await loadChatPrefs(db, connectionId));
  }, [db, connectionId]);

  // On a host switch, and on coming back to the list (the iPad sidebar stays
  // focused, which is why both).
  useEffect(() => {
    if (connectionId === null) return;
    let alive = true;
    void loadChatPrefs(db, connectionId).then((next) => {
      if (alive) setPrefs(next);
    });
    return () => {
      alive = false;
    };
  }, [db, connectionId]);
  useFocusEffect(useCallback(() => void reload(), [reload]));

  const prefFor = useCallback(
    (summary: ChatSummary) => activePref(prefs, summary.workspaceId, summary.sessionSig),
    [prefs]
  );

  const pinnedAt = useMemo(() => {
    const order = new Map<string, number>();
    for (const summary of summaries) {
      const at = prefFor(summary)?.pinnedAt;
      if (at !== undefined && at !== null) order.set(summary.workspaceId, at);
    }
    return order;
  }, [summaries, prefFor]);

  const togglePin = useCallback(
    (summary: ChatSummary) => {
      if (connectionId === null || summary.sessionSig === null) return;
      haptics.selection();
      const pinned = (prefFor(summary)?.pinnedAt ?? null) !== null;
      void saveChatPref(db, connectionId, summary.workspaceId, summary.sessionSig, {
        pinnedAt: pinned ? null : Date.now(),
      }).then(reload);
    },
    [db, connectionId, prefFor, reload]
  );

  const toggleMute = useCallback(
    (summary: ChatSummary) => {
      if (connection === null || summary.sessionSig === null) return;
      haptics.selection();
      const muted = prefFor(summary)?.muted ?? false;
      void saveChatPref(db, connection.id, summary.workspaceId, summary.sessionSig, { muted: !muted })
        .then(reload)
        .then(() => publishMutedChats(db, connection))
        .catch((thrown: unknown) => setError(`Couldn't update notifications on ${connection.name}. ${errorText(thrown)}`));
    },
    [db, connection, prefFor, reload]
  );

  return {
    pinnedAt,
    isPinned: (summary) => (prefFor(summary)?.pinnedAt ?? null) !== null,
    isMuted: (summary) => prefFor(summary)?.muted ?? false,
    togglePin,
    toggleMute,
    error,
    clearError: useCallback(() => setError(null), []),
  };
}
