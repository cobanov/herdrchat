import type { ThreadRead } from '@/lib/unread';
import type { ChatSummary, PaneSummary } from './useWorkspaces';

/**
 * A chat row as the chats list holds it: a summary plus where it lives.
 *
 * The list holds the chats of every saved host (`useHostChats`), and herdr
 * numbers each host's workspaces from `w1`. So within the list a workspace id
 * no longer names a row: everything the list files by row (pins, the open
 * chat, reads, the list's own keys) goes by `rowKey`, and every action runs on
 * the row's connection, not the selected host's.
 */

/** The other host a row is on, for its label; null on the selected host. */
export interface HostRef {
  id: string;
  label: string;
}

export interface ListedPane extends PaneSummary {
  /** The id of the host it is on. */
  connectionId: string;
  host: HostRef | null;
}

export interface ListedChat extends ChatSummary {
  /** The id of the host it is on. */
  connectionId: string;
  host: HostRef | null;
  panes: ListedPane[];
}

/** Tags a connection's summaries with where they live. */
export function listChats(
  summaries: readonly ChatSummary[],
  connectionId: string,
  host: HostRef | null
): ListedChat[] {
  return summaries.map((summary) => ({
    ...summary,
    connectionId,
    host,
    panes: summary.panes.map((pane) => ({ ...pane, connectionId, host })),
  }));
}

/**
 * A row's identity within the list: its connection and its workspace.
 * A newline cannot occur in either id.
 */
export function rowKey(summary: Pick<ListedChat, 'connectionId' | 'workspaceId'>): string {
  return `${summary.connectionId}\n${summary.workspaceId}`;
}

/**
 * What a row's testID is built from. The selected host's row keeps its bare
 * workspace id (`chat-row-w2`), as every flow already finds it; another
 * host's row puts that host's id first (`chat-row-<hostId>-w1`).
 */
export function rowTestKey(summary: { workspaceId: string; host?: HostRef | null }, paneId?: string): string {
  const own = paneId ?? summary.workspaceId;
  return summary.host === null || summary.host === undefined ? own : `${summary.host.id}-${own}`;
}

/** Read markers, per connection: each host's are filed under its own id. */
export type ReadsByConnection = ReadonlyMap<string, ReadonlyMap<string, ThreadRead>>;

const NO_READS: ReadonlyMap<string, ThreadRead> = new Map();

/** A row's read markers. */
export function readsOf(reads: ReadsByConnection, summary: Pick<ListedChat, 'connectionId'>): ReadonlyMap<string, ThreadRead> {
  return reads.get(summary.connectionId) ?? NO_READS;
}

/** The chat on screen beside the list (iPad): its connection, and its `chatKey`. */
export interface OpenChat {
  connectionId: string;
  key: string;
}

/**
 * The open chat's key as a row should compare it: only on the row's own
 * connection. `w1` open on one host is not `w1` on another.
 */
export function openFor(open: OpenChat | null, summary: Pick<ListedChat, 'connectionId'>): string | null {
  return open !== null && open.connectionId === summary.connectionId ? open.key : null;
}
