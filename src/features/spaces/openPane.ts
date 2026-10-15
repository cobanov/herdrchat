import { openChat } from '@/features/chats/navigation';
import { paneTarget } from '@/features/chats/paneTarget';
import type { ListedChat } from '@/features/chats/listedChat';
import { terminalRowParams } from '@/features/terminal/listRows';
import { openTerminal, type TerminalRouteParams } from '@/features/terminal/navigation';
import type { LayoutPane } from '@/lib/spaces/layout';

/**
 * What a box in a layout view opens, as data: an agent's chat (`paneTarget`),
 * or any other pane's terminal, attached exactly as its terminal row attaches
 * it. Data rather than a call, so the phone's sheet can hand it to the list
 * underneath and have it opened there on the list's next focus
 * (`useSpaceLayoutSheet`), instead of in the same batch as the sheet's pop.
 */
export type PaneOpen =
  | { kind: 'chat'; connectionId: string; workspaceId: string; title: string; paneId: string | undefined }
  | { kind: 'terminal'; params: TerminalRouteParams };

/**
 * What a box opens, or null for a box with nothing to open (a pane the
 * snapshot listed in a layout but nowhere else).
 */
export function paneOpen(summary: ListedChat, pane: LayoutPane): PaneOpen | null {
  const agent = summary.panes.find((item) => item.paneId === pane.paneId);
  if (agent !== undefined) {
    const target = paneTarget(summary, agent);
    return { kind: 'chat', connectionId: summary.connectionId, workspaceId: summary.workspaceId, title: target.title, paneId: target.paneId };
  }
  const shell = summary.shellPanes.find((item) => item.paneId === pane.paneId);
  if (shell !== undefined) return { kind: 'terminal', params: terminalRowParams(summary.connectionId, shell) };
  return null;
}

/** Opens what `paneOpen` described. */
export function applyPaneOpen(open: PaneOpen): void {
  if (open.kind === 'chat') openChat(open.connectionId, open.workspaceId, open.title, open.paneId);
  else openTerminal(open.params);
}
