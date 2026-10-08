import { chatKey } from '@/lib/chatKey';
import { isThreadUnread, type ThreadRead } from '@/lib/unread';
import { paneChats } from './chatGroups';
import type { ChatSummary, PaneSummary } from './useWorkspaces';

/**
 * Whether one agent of a workspace has a message you have not seen.
 *
 * Seen in either of two threads: the agent's own, or the workspace's, which
 * merges every agent and so shows this one too. Reading the merged thread and
 * coming back to a dot on each agent under it would ask you to read the same
 * lines twice. Each marker carries the session signature its thread had, so a
 * new conversation in a recycled pane is never silenced by an old one's.
 *
 * `open` is the chat on screen beside the list (iPad), by `chatKey`: it is
 * being read right now, and its marker is only stamped when it closes.
 */
export function isPaneUnread(
  summary: ChatSummary,
  pane: PaneSummary,
  reads: ReadonlyMap<string, ThreadRead>,
  open: string | null = null
): boolean {
  const own = chatKey({ workspaceId: summary.workspaceId, paneId: pane.paneId });
  if (open === own || open === summary.workspaceId) return false;
  return (
    isThreadUnread(pane.preview, pane.sessionSig, reads.get(own)) &&
    isThreadUnread(pane.preview, summary.sessionSig, reads.get(summary.workspaceId))
  );
}

/**
 * Whether a workspace's row gets the unread dot.
 *
 * A workspace with one agent is exactly what it was. One with several is
 * unread while any of its agents is: its row's preview is only the newest of
 * their lines, so comparing that one line against one marker would miss an
 * older reply in the other agent that nobody has opened.
 */
export function isChatUnread(
  summary: ChatSummary,
  reads: ReadonlyMap<string, ThreadRead>,
  open: string | null = null
): boolean {
  if (open === summary.workspaceId) return false;
  const panes = paneChats(summary);
  if (panes.length === 0) return isThreadUnread(summary.preview, summary.sessionSig, reads.get(summary.workspaceId));
  return panes.some((pane) => isPaneUnread(summary, pane, reads, open));
}
