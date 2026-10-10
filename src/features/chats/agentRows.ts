import { chatKey } from '@/lib/chatKey';
import type { ThreadRead } from '@/lib/unread';
import { isChatUnread, isPaneUnread } from './chatUnread';
import { rowKey, rowTestKey, type ListedChat, type ListedPane } from './listedChat';

/**
 * The Agents view of the chats list: one row per conversational agent, flat,
 * across every workspace of the host and its machines (`listModes`).
 *
 * A row here IS a chat summary, shaped exactly like the workspace of a
 * one-agent workspace: its agent's status, preview, session and title, and
 * the workspace's label, id, machine and connection. That is what lets the
 * Agents view share everything the Spaces view already has instead of growing
 * a second copy of it: `groupChats` groups and searches it, `ChatRow` and its
 * swipe draw it (`rowTitle` titles it by the session, `rowContext` leads its
 * line with the machine and the workspace), and rename and close act on its
 * workspace, which is where they act from an agent's row in Spaces too.
 *
 * What makes it the agent's row and not the workspace's is its `chatKey`: the
 * key its chat is stored under (`w2` for a one-agent workspace, `w6/w6:p2` for
 * one agent of several). Pins, reads and the open chat go by it, so a
 * one-agent workspace pinned in either view is pinned in both.
 */
export interface AgentRow extends ListedChat {
  /** The key the agent's chat is stored under (`chatKey`). */
  chatKey: string;
  /**
   * The agent, when it is one of several in its workspace and its row opens
   * that agent's own thread. Null for a one-agent workspace, whose row opens
   * the workspace chat, exactly as its row in Spaces does, so the two share a
   * thread, a read marker and a pin.
   */
  pane: ListedPane | null;
  /** The workspace the agent is in, as Spaces lists it: what unread is worked out against. */
  workspace: ListedChat;
}

/** Whether a listed row is an agent's (the Agents view) rather than a workspace's. */
export function isAgentRow(summary: ListedChat): summary is AgentRow {
  return 'chatKey' in summary;
}

/**
 * Every agent, in the host's order: a workspace's agents in its snapshot
 * order, where its card would have been. A workspace with no conversational
 * agent (a shell only) has no row: there is nobody in it to talk to.
 */
export function agentRows(summaries: readonly ListedChat[]): AgentRow[] {
  return summaries.flatMap((workspace): AgentRow[] => {
    if (workspace.panes.length === 0) return [];
    if (workspace.panes.length === 1) {
      return [{ ...workspace, chatKey: workspace.workspaceId, pane: null, workspace }];
    }
    return workspace.panes.map((pane): AgentRow => ({
      ...workspace,
      status: pane.status,
      preview: pane.preview,
      sessionSig: pane.sessionSig,
      sessionTitle: pane.sessionTitle,
      agentName: pane.agentName,
      // Its own agent only, so a search for a sibling's folder does not find
      // it, and the row's line names this agent's provider and folder.
      agents: [pane.agent],
      panes: [pane],
      chatKey: chatKey({ workspaceId: workspace.workspaceId, paneId: pane.paneId }),
      pane,
      workspace,
    }));
  });
}

/**
 * An agent row's identity in the list: its connection and its chat. A
 * one-agent workspace's is its `rowKey`, so its pin orders it the same in both
 * views.
 */
export function agentRowKey(row: Pick<AgentRow, 'connectionId' | 'chatKey'>): string {
  return rowKey({ connectionId: row.connectionId, workspaceId: row.chatKey });
}

/**
 * What an agent row's testID is built from: the workspace's own key for a
 * one-agent workspace (`chat-row-w2`, as in Spaces), the pane's for one agent
 * of several (`chat-row-w6:p2`), each led by the machine's id on a machine.
 */
export function agentTestKey(row: AgentRow): string {
  return rowTestKey(row, row.pane?.paneId);
}

/** Whether an agent row gets the unread dot: as its row in Spaces would. */
export function isAgentUnread(row: AgentRow, reads: ReadonlyMap<string, ThreadRead>, open: string | null = null): boolean {
  return row.pane === null ? isChatUnread(row.workspace, reads, open) : isPaneUnread(row.workspace, row.pane, reads, open);
}
