import { router } from 'expo-router';

import type { TerminalPaneKind } from '@/lib/terminal/command';

/** What `app/chat/terminal` is opened with. */
export interface TerminalRouteParams {
  /** The pane's connection: a host, or one of its machines (`${hostId}/${machineId}`). */
  connectionId: string;
  paneId: string;
  /** Which attach it takes (`paneKind`): an agent pane's own, or the session's zoomed on a shell pane. */
  kind: TerminalPaneKind;
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
