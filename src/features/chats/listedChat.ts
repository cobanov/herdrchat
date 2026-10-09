import type { ThreadRead } from '@/lib/unread';
import type { ChatSummary, PaneSummary } from './useWorkspaces';

/**
 * A chat row as the chats list holds it: a summary plus where it lives.
 *
 * One host's list also lists the chats of the machines saved on that host
 * (`useHostChats`), and herdr numbers each machine's workspaces from `w1`
 * like the host's own. So within the list a workspace id no longer names a
 * row: everything the list files by row (pins, the open chat, reads, the
 * list's own keys) goes by `rowKey`, and every action runs on the row's
 * connection, not the selected host's.
 */

/** The machine a row is on, for its label; null on the host itself. */
export interface MachineRef {
  id: string;
  label: string;
}

export interface ListedPane extends PaneSummary {
  /** The host's id, or the machine's (`${hostId}/${machineId}`). */
  connectionId: string;
  machine: MachineRef | null;
}

export interface ListedChat extends ChatSummary {
  /** The host's id, or the machine's (`${hostId}/${machineId}`). */
  connectionId: string;
  machine: MachineRef | null;
  panes: ListedPane[];
}

/** Tags a connection's summaries with where they live. */
export function listChats(
  summaries: readonly ChatSummary[],
  connectionId: string,
  machine: MachineRef | null
): ListedChat[] {
  return summaries.map((summary) => ({
    ...summary,
    connectionId,
    machine,
    panes: summary.panes.map((pane) => ({ ...pane, connectionId, machine })),
  }));
}

/**
 * A row's identity within one host's list: its connection and its workspace.
 * A newline cannot occur in either id.
 */
export function rowKey(summary: Pick<ListedChat, 'connectionId' | 'workspaceId'>): string {
  return `${summary.connectionId}\n${summary.workspaceId}`;
}

/**
 * What a row's testID is built from. A host's row keeps its bare workspace
 * id (`chat-row-w2`), as every flow already finds it; a machine's row puts
 * the machine's id first (`chat-row-demo-nuku-w1`). Not the connection id: it
 * holds a slash, and the host is the one whose list this is anyway.
 */
export function rowTestKey(summary: { workspaceId: string; machine?: MachineRef | null }, paneId?: string): string {
  const own = paneId ?? summary.workspaceId;
  return summary.machine === null || summary.machine === undefined ? own : `${summary.machine.id}-${own}`;
}

/** Read markers, per connection: a machine's are filed under its own id. */
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
 * connection. `w1` open on the host is not `w1` on a machine.
 */
export function openFor(open: OpenChat | null, summary: Pick<ListedChat, 'connectionId'>): string | null {
  return open !== null && open.connectionId === summary.connectionId ? open.key : null;
}

/**
 * The one line a machine that failed gets at the end of its host's list.
 *
 * A machine the host cannot reach already says so in a sentence naming both
 * ("Gimel can't reach klaw right now."). Anything else is herdr's own
 * sentence about the machine, which does not say which machine it is, so the
 * label goes first.
 */
export function machineNotice(label: string, error: string, errorCode: string | null): string {
  if (errorCode === 'connect_failed' && error.includes(label)) return error;
  return `${label}: ${error}`;
}
