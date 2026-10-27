import { useRouter } from 'expo-router';
import type * as SQLite from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { confirmDestructive, showActionSheet, type SheetAction } from '@/components/ActionSheet';
import { haptics } from '@/components/haptics';
import { terminalRowParams } from '@/features/terminal/listRows';
import { openTerminal } from '@/features/terminal/navigation';
import type { HerdrClient } from '@/lib/herdr/client';
import { errorText } from '@/lib/herdr/protocol';
import { AGENT_VERBS_VERSION, atLeast } from '@/lib/herdr/version';
import { forgetWorkspace } from '@/state/threadCache';
import { isTerminalAvailable } from '../../../modules/herdr-terminal/src';
import { rowTitle } from './rowText';
import type { ChatSummary } from './useWorkspaces';

/**
 * Rename and close, as the three affordances that reach them: a swipe action, a
 * long-press menu, and the confirmation each destructive one goes through. The
 * menu also opens a shell in the workspace, as a tab or a split.
 *
 * Out of the route because it is not layout. The screen composes rows; this
 * decides what happens to a workspace and how a person is asked first.
 */
export function useChatActions<S extends ChatSummary = ChatSummary>({
  client,
  connectionId,
  targetOf,
  db,
  refresh,
  onClosed,
}: {
  client: HerdrClient | null;
  connectionId: string | null;
  /**
   * Where a row's actions run, when that is not the host's `client`: a chat
   * on another host is renamed and closed there, through its own client. Null for a row nothing can be done to now.
   */
  targetOf?: (summary: S) => { client: HerdrClient; connectionId: string } | null;
  db: SQLite.SQLiteDatabase;
  refresh: () => Promise<void>;
  /** Called with the closed workspace and the connection it was on. */
  onClosed?: (workspaceId: string, connectionId: string) => void;
}): {
  /** Failures from rename/close, which happen outside the poll's own error path. */
  error: string | null;
  clearError: () => void;
  renameChat: (summary: S) => void;
  closeChat: (summary: S) => void;
  /** `extra` goes above Rename and Close: pin and mute, which are the chat list's. */
  /** `pressedPane`: the agent row pressed, which Split terminal splits beside. */
  manageChat: (summary: S, extra?: readonly SheetAction[], pressedPane?: string) => void;
} {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const target = useCallback(
    (summary: S) =>
      targetOf !== undefined
        ? targetOf(summary)
        : client === null || connectionId === null ? null : { client, connectionId },
    [targetOf, client, connectionId]
  );

  const renameChat = useCallback(
    (summary: S) => {
      const on = target(summary);
      if (on === null) return;
      // The sheet resolves its client from the row's connection, so another
      // host's workspace is renamed on that host.
      router.push({
        pathname: '/rename-chat',
        params: { workspaceId: summary.workspaceId, title: summary.title, connectionId: on.connectionId },
      });
    },
    [router, target]
  );

  /**
   * Close is destructive on the HOST, not just in the app — it stops every tab,
   * pane and running process in the workspace — so the confirmation says that in
   * those words rather than asking a vague "are you sure".
   */
  const closeChat = useCallback(
    (summary: S) => {
      const on = target(summary);
      if (on === null) return;
      // Named as the row the person pressed is, by its session; the workspace
      // it closes is named in the message, since that is what stops.
      const label = summary.title.trim() || summary.workspaceId;
      const title = rowTitle(summary);
      confirmDestructive({
        title: `Close ${title}?`,
        message:
          `${title === label ? 'Every' : `This closes workspace ${label}: every`} tab, pane and running process in it stops. The conversation stays on disk, but the agent does not.`,
        confirmLabel: 'Close chat',
        onConfirm: () => {
          void on.client
            .closeWorkspace(summary.workspaceId)
            // Drop the cache too: herdr recycles workspace ids, and the next
            // chat to land in this slot must not open showing this one's
            // messages.
            .then(() => forgetWorkspace(db, on.connectionId, summary.workspaceId))
            .then(() => onClosed?.(summary.workspaceId, on.connectionId))
            .then(refresh)
            .catch((thrown: unknown) => setError(errorText(thrown)));
        },
      });
    },
    [target, db, refresh, onClosed]
  );

  /**
   * A shell in the workspace, opened at once: a tab of its own, or a split
   * beside the agent whose row was pressed. A workspace's own row has none,
   * so it splits the pane the desktop has in focus.
   */
  const openShell = useCallback(
    (summary: S, how: 'tab' | 'split', pressed: string | undefined) => {
      const on = target(summary);
      if (on === null) return;
      const beside = pressed
        ?? summary.panes.find((pane) => pane.agent.focused)?.paneId
        ?? summary.panes[0]?.paneId
        ?? summary.shellPanes[0]?.paneId;
      const made = how === 'split' && beside !== undefined
        ? on.client.splitPane(beside, 'right')
        : on.client.createTab(summary.workspaceId);
      void made
        .then((pane) => {
          openTerminal(terminalRowParams(on.connectionId, { paneId: pane.paneId, pane, processName: null }));
          return refresh();
        })
        .catch((thrown: unknown) => setError(errorText(thrown)));
    },
    [target, refresh]
  );

  /**
   * The same two actions the row's swipe offers, as a long-press menu.
   *
   * Both affordances on purpose. The swipe is faster once you know it is there,
   * and the long press is the one a person finds by trying things — an action
   * reachable only by a gesture is an action most people never reach.
   */
  const manageChat = useCallback(
    (summary: S, extra: readonly SheetAction[] = [], pressedPane?: string) => {
      const on = target(summary);
      if (on === null) return;
      // Where a terminal can open, on a herdr with `tab create` and `pane split`.
      const shells = isTerminalAvailable && atLeast(on.client.reportedVersion, AGENT_VERBS_VERSION);
      haptics.medium();
      showActionSheet({
        // The row's own title, so the sheet names what was pressed. Rename
        // says workspace, and prefills its label, since that is what it
        // renames: a row titled by its session no longer shows that label.
        title: rowTitle(summary),
        actions: [
          ...extra,
          ...(shells ? [
            { label: 'New terminal tab', onPress: () => openShell(summary, 'tab', pressedPane) },
            { label: 'Split terminal', onPress: () => openShell(summary, 'split', pressedPane) },
          ] : []),
          { label: 'Rename workspace…', onPress: () => renameChat(summary) },
          { label: 'Close chat', destructive: true, onPress: () => closeChat(summary) },
        ],
      });
    },
    [target, renameChat, closeChat, openShell]
  );

  return {
    error,
    clearError: useCallback(() => setError(null), []),
    renameChat,
    closeChat,
    manageChat,
  };
}
