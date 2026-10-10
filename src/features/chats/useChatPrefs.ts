import type * as SQLite from 'expo-sqlite';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { publishMutedChats } from '@/features/notifications/mutedChats';
import { prefSource, type ChatPref, type PrefRef } from '@/lib/chatPrefs';
import { haptics } from '@/lib/haptics';
import type { ServerConnection } from '@/state/connections';
import { loadChatPrefs, saveChatPref } from '@/state/db';
import { agentPrefRow } from './agentRows';
import { paneChats } from './chatGroups';
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
 *
 * A row may name a chat other than its workspace's (`PrefRow.chatKey`): an
 * agent's row in the Agents view pins and mutes that agent's chat, filed
 * under its `chatKey` (`w6/w6:p2`) with its own session. A one-agent
 * workspace's agent row names the workspace chat, so a pin made in either
 * view is the same pin. An agent of several is also pinned and muted by what
 * it inherits (`PrefRow.inherits`, `prefSource`): its workspace's card, and
 * the pref it got while it was the workspace's only agent. Its row in Spaces
 * (`PaneRow`) is the same `PrefRow` as its row in Agents (`agentPrefRow`), so
 * the two views always agree about an agent. `pinnedAt` files those by the
 * same key the Agents view groups by (`agentRowKey`).
 */
export function useChatPrefs(
  db: SQLite.SQLiteDatabase,
  connection: ServerConnection | null,
  summaries: readonly ListedChat[],
  /** The host's id and its machines': whose prefs to load. */
  connectionIds: readonly string[] = connection === null ? [] : [connection.id]
): {
  pinnedAt: ReadonlyMap<string, number>;
  isPinned: (summary: PrefRow) => boolean;
  isMuted: (summary: PrefRow) => boolean;
  /** Whether muting means anything for this row: only the host's own chats notify. */
  canMute: (summary: PrefRow) => boolean;
  togglePin: (summary: PrefRow) => void;
  toggleMute: (summary: PrefRow) => void;
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

  /** The pref that pins, or mutes, a row: its own or one it inherits. */
  const sourceOf = useCallback(
    (summary: PrefRow, choice: 'pin' | 'mute'): PrefRef | null =>
      prefSource(prefs.get(summary.connectionId) ?? NO_PREFS, refsOf(summary), choice),
    [prefs]
  );
  const pinOf = useCallback(
    (summary: PrefRow): number | null => {
      const source = sourceOf(summary, 'pin');
      return source === null ? null : prefs.get(summary.connectionId)?.get(source.key)?.pinnedAt ?? null;
    },
    [prefs, sourceOf]
  );

  const pinnedAt = useMemo(() => {
    const order = new Map<string, number>();
    const file = (summary: PrefRow) => {
      const at = pinOf(summary);
      if (at !== null) order.set(rowKey({ connectionId: summary.connectionId, workspaceId: prefKey(summary) }), at);
    };
    for (const summary of summaries) {
      file(summary);
      // Each agent of a workspace that runs several, as its row in the
      // Agents view is filed.
      for (const pane of paneChats(summary)) file(agentPrefRow(summary, pane));
    }
    return order;
  }, [summaries, pinOf]);

  const togglePin = useCallback(
    (summary: PrefRow) => {
      if (summary.sessionSig === null) return;
      haptics.selection();
      // Unpinning clears whatever pins the row, which may be its workspace.
      const source = sourceOf(summary, 'pin');
      const target = source ?? { key: prefKey(summary), sessionSig: summary.sessionSig };
      if (target.sessionSig === null) return;
      void saveChatPref(db, summary.connectionId, target.key, target.sessionSig, {
        pinnedAt: source === null ? Date.now() : null,
      }).then(reload);
    },
    [db, sourceOf, reload]
  );

  const canMute = useCallback(
    (summary: PrefRow) => connection !== null && summary.connectionId === connection.id,
    [connection]
  );

  const toggleMute = useCallback(
    (summary: PrefRow) => {
      if (connection === null || summary.sessionSig === null || !canMute(summary)) return;
      haptics.selection();
      // Unmuting clears whatever silences the row: muted from its workspace's
      // card, the host is quiet about every agent in it, and an "Unmute" that
      // left that mute in place would change nothing the person can hear.
      const source = sourceOf(summary, 'mute');
      const target = source ?? { key: prefKey(summary), sessionSig: summary.sessionSig };
      if (target.sessionSig === null) return;
      void saveChatPref(db, connection.id, target.key, target.sessionSig, { muted: source === null })
        .then(reload)
        .then(() => publishMutedChats(db, connection))
        .catch((thrown: unknown) => setError(`Couldn't update notifications on ${connection.name}. ${errorText(thrown)}`));
    },
    [db, connection, canMute, sourceOf, reload]
  );

  return {
    pinnedAt,
    isPinned: (summary) => sourceOf(summary, 'pin') !== null,
    isMuted: (summary) => canMute(summary) && sourceOf(summary, 'mute') !== null,
    canMute,
    togglePin,
    toggleMute,
    error,
    clearError: useCallback(() => setError(null), []),
  };
}

const NO_PREFS: ReadonlyMap<string, ChatPref> = new Map();

/**
 * What a pin or mute is made on: a row's connection, its session, and the
 * chat it names, the workspace's unless `chatKey` says otherwise. `inherits`
 * lists the prefs that also pin or mute it, after its own (`agentPrefRow`).
 */
export type PrefRow = Pick<ListedChat, 'connectionId' | 'workspaceId' | 'sessionSig'> & {
  chatKey?: string;
  inherits?: readonly PrefRef[];
};

/** The key a row's pref is filed under: its `chatKey`, or its workspace's. */
function prefKey(summary: PrefRow): string {
  return summary.chatKey ?? summary.workspaceId;
}

/** Every pref that can pin or mute a row, its own first. */
function refsOf(summary: PrefRow): PrefRef[] {
  return [{ key: prefKey(summary), sessionSig: summary.sessionSig }, ...(summary.inherits ?? [])];
}

async function loadAll(
  db: SQLite.SQLiteDatabase,
  connectionIds: readonly string[]
): Promise<Map<string, ReadonlyMap<string, ChatPref>>> {
  const loaded = await Promise.all(connectionIds.map(async (id) => [id, await loadChatPrefs(db, id)] as const));
  return new Map(loaded);
}
