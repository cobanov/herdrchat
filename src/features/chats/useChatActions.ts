import { useRouter } from 'expo-router';
import type * as SQLite from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { confirmDestructive, showActionSheet } from '@/components/ActionSheet';
import { haptics } from '@/lib/haptics';
import type { HerdrClient } from '@/lib/herdr/client';
import { forgetWorkspace } from '@/state/threadCache';
import { errorText, type ChatSummary } from './useWorkspaces';

/**
 * Rename and close, as the three affordances that reach them: a swipe action, a
 * long-press menu, and the confirmation each destructive one goes through.
 *
 * Out of the route because it is not layout. The screen composes rows; this
 * decides what happens to a workspace and how a person is asked first.
 */
export function useChatActions({
  client,
  connectionId,
  db,
  refresh,
}: {
  client: HerdrClient | null;
  connectionId: string | null;
  db: SQLite.SQLiteDatabase;
  refresh: () => Promise<void>;
}): {
  /** Failures from rename/close, which happen outside the poll's own error path. */
  error: string | null;
  clearError: () => void;
  renameChat: (summary: ChatSummary) => void;
  closeChat: (summary: ChatSummary) => void;
  manageChat: (summary: ChatSummary) => void;
} {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const renameChat = useCallback(
    (summary: ChatSummary) => {
      router.push({
        pathname: '/rename-chat',
        params: { workspaceId: summary.workspaceId, title: summary.title },
      });
    },
    [router]
  );

  /**
   * Close is destructive on the HOST, not just in the app — it stops every tab,
   * pane and running process in the workspace — so the confirmation says that in
   * those words rather than asking a vague "are you sure".
   */
  const closeChat = useCallback(
    (summary: ChatSummary) => {
      if (client === null || connectionId === null) return;
      confirmDestructive({
        title: `Close ${summary.title}?`,
        message:
          'Every tab, pane and running process in this workspace stops. The conversation stays on disk, but the agent does not.',
        confirmLabel: 'Close chat',
        onConfirm: () => {
          void client
            .closeWorkspace(summary.workspaceId)
            // Drop the cache too: herdr recycles workspace ids, and the next
            // chat to land in this slot must not open showing this one's
            // messages.
            .then(() => forgetWorkspace(db, connectionId, summary.workspaceId))
            .then(refresh)
            .catch((thrown: unknown) => setError(errorText(thrown)));
        },
      });
    },
    [client, connectionId, db, refresh]
  );

  /**
   * The same two actions the row's swipe offers, as a long-press menu.
   *
   * Both affordances on purpose. The swipe is faster once you know it is there,
   * and the long press is the one a person finds by trying things — an action
   * reachable only by a gesture is an action most people never reach.
   */
  const manageChat = useCallback(
    (summary: ChatSummary) => {
      if (client === null) return;
      haptics.medium();
      showActionSheet({
        title: summary.title,
        actions: [
          { label: 'Rename…', onPress: () => renameChat(summary) },
          { label: 'Close chat', destructive: true, onPress: () => closeChat(summary) },
        ],
      });
    },
    [client, renameChat, closeChat]
  );

  return {
    error,
    clearError: useCallback(() => setError(null), []),
    renameChat,
    closeChat,
    manageChat,
  };
}
