import { chatKey } from '@/lib/chatKey';
import { needsAttention } from '@/lib/herdr/models';
import { isThreadUnread, type ThreadRead } from '@/lib/unread';
import { paneChats } from './chatGroups';
import type { ChatSummary, PaneSummary } from './useWorkspaces';

/**
 * The signature to hold the workspace thread's read marker to, for one agent.
 *
 * By membership, not by the whole signature: the merged thread showed this
 * agent's lines whatever its neighbours were, so a sibling joining, leaving or
 * starting over must not turn this agent's read into unread. Comparing the
 * whole signature did. A new session in a recycled pane has an id the old
 * marker never held, so it still reads as unread.
 */
function mergedSigFor(summary: ChatSummary, pane: PaneSummary, read: ThreadRead | undefined): string | null {
  if (read === undefined || pane.sessionSig === null) return summary.sessionSig;
  return read.sessionSig.split(',').includes(pane.sessionSig) ? read.sessionSig : summary.sessionSig;
}

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
  const merged = reads.get(summary.workspaceId);
  return (
    isThreadUnread(pane.preview, pane.sessionSig, reads.get(own)) &&
    isThreadUnread(pane.preview, mergedSigFor(summary, pane, merged), merged)
  );
}

/**
 * Whether a workspace's row gets the unread dot.
 *
 * A workspace with one agent is what it was, except that a read made in that
 * agent's own chat, back when the workspace held a second one, still counts:
 * it is the same conversation, and ignoring it lit a dot for a reply already
 * read the moment the other agent closed. One with several is unread while
 * any of its agents is: its row's preview is only the newest of their lines,
 * so comparing that one line against one marker would miss an older reply in
 * the other agent that nobody has opened.
 */
export function isChatUnread(
  summary: ChatSummary,
  reads: ReadonlyMap<string, ThreadRead>,
  open: string | null = null
): boolean {
  if (open === summary.workspaceId) return false;
  const panes = paneChats(summary);
  if (panes.length > 0) return panes.some((pane) => isPaneUnread(summary, pane, reads, open));
  if (!isThreadUnread(summary.preview, summary.sessionSig, reads.get(summary.workspaceId))) return false;
  const [only] = summary.panes;
  if (only === undefined || only.sessionSig === null) return true;
  const own = chatKey({ workspaceId: summary.workspaceId, paneId: only.paneId });
  return open !== own && isThreadUnread(summary.preview, only.sessionSig, reads.get(own));
}

/**
 * Whether a workspace counts toward the badge: it needs you, or it is unread.
 *
 * The chat on screen beside the list is not news. With the workspace chat
 * open the workspace does not count at all. With one agent of it open, it
 * counts for its other agents only: the workspace's status rolls every agent
 * up, so asking it counted the very agent being answered on screen.
 */
export function chatWantsYou(
  summary: ChatSummary,
  reads: ReadonlyMap<string, ThreadRead>,
  open: string | null = null
): boolean {
  if (open === summary.workspaceId) return false;
  const panes = paneChats(summary);
  const onScreen = panes.find((pane) => chatKey({ workspaceId: summary.workspaceId, paneId: pane.paneId }) === open);
  const blocked = onScreen === undefined
    ? needsAttention(summary.status)
    : panes.some((pane) => pane !== onScreen && needsAttention(pane.status));
  return blocked || isChatUnread(summary, reads, open);
}
