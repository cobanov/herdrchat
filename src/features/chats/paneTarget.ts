import { chatKey } from '@/lib/chatKey';
import { paneTitle } from './rowText';
import type { ChatSummary, PaneSummary } from './useWorkspaces';

/**
 * Which chat an agent's row under a space card, or its box in the layout
 * view, opens, and the key that chat is stored, pinned and selected under.
 *
 * The one agent of a workspace that also holds a shell is the workspace chat
 * (`w2`), exactly as when its card was the chat, and as its row in the Agents
 * view is: one conversation, one thread, one read marker and one pin, whichever
 * row it is opened from. One agent of several is its own chat (`w6/w6:p2`).
 */
export function paneTarget(summary: ChatSummary, pane: PaneSummary): { paneId: string | undefined; title: string; key: string } {
  const alone = summary.panes.length === 1;
  return {
    paneId: alone ? undefined : pane.paneId,
    title: paneTitle(summary, pane),
    key: chatKey({ workspaceId: summary.workspaceId, paneId: alone ? undefined : pane.paneId }),
  };
}
