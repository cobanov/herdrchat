/**
 * Which chat a row, a thread, a draft or a read marker belongs to.
 *
 * A workspace used to be the only kind of chat, so its id was the key for all
 * of these. A workspace can hold several agents, and each of them is a chat of
 * its own as well: `paneId` absent is the workspace chat (every agent merged,
 * as before), present is the one agent in that pane.
 *
 * herdr recycles pane ids the way it recycles workspace ids, so this key names
 * a slot, not a conversation. Whatever is cached under it still carries the
 * session signature, exactly as the workspace chat's cache does.
 */
export interface ChatRef {
  workspaceId: string;
  /** Absent, null or empty: the workspace chat. */
  paneId?: string | null;
}

/**
 * The string a chat is stored under: `w1` for the workspace, `w1/w1:p2` for
 * one pane in it.
 *
 * The workspace chat's key is its bare id, so read markers and drafts written
 * before panes had chats of their own still find their chat. A slash cannot be
 * mistaken for part of a workspace id: herdr's ids, like the ids this app
 * interpolates into shell commands, never contain one.
 */
export function chatKey({ workspaceId, paneId }: ChatRef): string {
  return paneId === undefined || paneId === null || paneId === '' ? workspaceId : `${workspaceId}/${paneId}`;
}
