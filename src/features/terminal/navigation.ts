import { router } from 'expo-router';

import type { TerminalPaneKind } from '@/lib/terminal/command';

/** What `app/chat/terminal` is opened with. */
export interface TerminalRouteParams {
  /** The pane's connection: a host, or one of its machines (`${hostId}/${machineId}`). */
  connectionId: string;
  paneId: string;
  /** Which attach it takes (`paneKind`): `agent attach` by pane id, or `terminal attach` by terminal id. */
  kind: TerminalPaneKind;
  /** The pane's terminal (the snapshot's `terminal_id`); `''` when the snapshot had none. */
  terminalId: string;
  title: string;
}

/**
 * Opens a pane's terminal, pushed over what opened it: a chat, or the chats.
 * On iPad too, over the split, like a subagent's transcript: it belongs to
 * the pane behind it, and is never the split's selection.
 */
export function openTerminal(params: TerminalRouteParams) {
  router.push({ pathname: '/chat/terminal', params: { ...params } });
}
