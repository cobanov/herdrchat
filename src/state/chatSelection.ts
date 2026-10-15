import { create } from 'zustand';

import type { TerminalPaneKind } from '@/lib/terminal/command';

export interface ChatSelection {
  connectionId: string;
  workspaceId: string;
  title: string;
  /** Set when one agent of a workspace is open rather than the workspace chat. */
  paneId?: string;
}

/** A chat in the iPad's detail column: the workspace's, or one agent's. */
export type ChatDetail = { kind: 'chat' } & ChatSelection;

/** A pane's terminal in the iPad's detail column, beside the chats. */
export interface TerminalDetail {
  kind: 'terminal';
  /** The pane's connection: a host, or one of its machines. */
  connectionId: string;
  paneId: string;
  /** The pane's terminal (the snapshot's `terminal_id`), which a shell pane attaches by. */
  terminalId: string | null;
  paneKind: TerminalPaneKind;
  title: string;
  /** The chat the terminal was opened from, which its Back brings back; null for the chats alone. */
  from: ChatSelection | null;
}

/** What the iPad's detail column shows. */
export type Detail = ChatDetail | TerminalDetail;

/** The open chat, if the detail is one: the same object, so a selector may return it. */
export function chatOf(detail: Detail | null): ChatDetail | null {
  return detail?.kind === 'chat' ? detail : null;
}

/** The open terminal, if the detail is one. */
export function terminalOf(detail: Detail | null): TerminalDetail | null {
  return detail?.kind === 'terminal' ? detail : null;
}

/** The chat a detail stands for, as `select` takes it: what a terminal's Back restores. */
export function chatSelectionOf(detail: Detail | null): ChatSelection | null {
  const chat = chatOf(detail);
  if (chat === null) return null;
  return {
    connectionId: chat.connectionId,
    workspaceId: chat.workspaceId,
    title: chat.title,
    ...(chat.paneId !== undefined ? { paneId: chat.paneId } : {}),
  };
}

/** A workspace just closed from the list: where it was, and every pane it had. */
export interface ClosedWorkspace {
  connectionId: string;
  workspaceId: string;
  /** Its chats' panes and its terminal rows' panes, as the list last had them. */
  paneIds: readonly string[];
}

/**
 * The detail once a workspace has closed. Its chat goes, and so does a
 * terminal on one of its panes, which would otherwise stay in the column
 * pointing at a pane that no longer exists. A terminal on another workspace
 * stays, but forgets a way back to the closed chat, so Back cannot bring it
 * back. By the list's panes, not by reading herdr's pane id format.
 */
export function detailAfterClose(detail: Detail | null, closed: ClosedWorkspace): Detail | null {
  if (detail === null) return null;
  const isClosed = (chat: ChatSelection | null) =>
    chat !== null && chat.connectionId === closed.connectionId && chat.workspaceId === closed.workspaceId;
  if (detail.kind === 'chat') return isClosed(detail) ? null : detail;
  if (detail.connectionId === closed.connectionId && closed.paneIds.includes(detail.paneId)) return null;
  return isClosed(detail.from) ? { ...detail, from: null } : detail;
}

// Keep the tablet selection outside the URL, bound to its host, so opening and
// closing Hosts or Settings over the chats does not discard the open detail.
// (It moved here when native tab presses reset route params; the tabs are gone,
// but a store still outlives what the URL is doing.)
//
// One detail at a time: selecting a chat replaces a terminal, and the other way
// round, so the column never has two claims on it.
export const useChatSelection = create<{
  detail: Detail | null;
  /** Shows a chat, or nothing (the "Select a conversation" state). */
  select: (selection: ChatSelection | null) => void;
  /** Shows a pane's terminal in place of whatever was there. */
  showTerminal: (terminal: Omit<TerminalDetail, 'kind'>) => void;
  /** Drops whatever in the detail belongs to a workspace just closed (`detailAfterClose`). */
  workspaceClosed: (closed: ClosedWorkspace) => void;
}>((set) => ({
  detail: null,
  select: (selection) => set({ detail: selection === null ? null : { kind: 'chat', ...selection } }),
  showTerminal: (terminal) => set({ detail: { kind: 'terminal', ...terminal } }),
  workspaceClosed: (closed) => set((state) => ({ detail: detailAfterClose(state.detail, closed) })),
}));
