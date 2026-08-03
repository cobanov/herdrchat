/**
 * Whether a chat row should show an unread dot.
 *
 * Derived rather than stored. The alternative — a boolean someone sets when a
 * message arrives and clears when the thread opens — needs both halves to fire
 * exactly once, and a missed clear leaves a dot that nothing can remove. Here
 * the only thing persisted is when you last opened a thread, and "unread" is a
 * comparison against the preview the list already fetches.
 */

/** When a thread was last opened, and which conversation that was. */
export interface ThreadRead {
  /**
   * The session this read marker belongs to. A workspace id is a slot herdr
   * reuses, so without this a new chat in a recycled workspace would start life
   * already marked read by whatever the previous chat's marker said.
   */
  sessionSig: string;
  openedAt: number;
}

/** The chat list's last-message line for one workspace. */
export interface UnreadPreview {
  timestamp: number | null;
  fromUser: boolean;
}

export function isThreadUnread(
  preview: UnreadPreview | null,
  sessionSig: string | null,
  read: ThreadRead | undefined
): boolean {
  // Nothing to have missed.
  if (preview === null) return false;
  // Your own message is not news to you.
  if (preview.fromUser) return false;
  // A transcript line with no usable time cannot be compared against anything.
  // Treated as read: a dot that never clears is worse than a dot that never
  // appears, because only one of the two can be dismissed by the user.
  if (preview.timestamp === null) return false;

  // Never opened → unread, and there is an agent message to justify it.
  if (read === undefined) return true;

  // The marker describes a different conversation that happened to sit in this
  // workspace slot. It says nothing about this one, so fall back to unread.
  if (sessionSig !== null && read.sessionSig !== sessionSig) return true;

  return preview.timestamp > read.openedAt;
}
