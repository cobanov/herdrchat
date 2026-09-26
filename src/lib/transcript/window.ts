import type { ChatMessage } from './message';

/**
 * The messages to show after the live stream restarts and re-reads the end of
 * the transcript, or null when the new window cannot continue the old one.
 *
 * A restart is routine: the SSH channel drops, the app comes back from the
 * background, the watchdog finds a stream gone quiet. Replacing the window
 * outright dropped whatever older history the reader had paged back to, and the
 * list, re-keyed to show a new window, rebuilt itself at the end: a reader
 * scrolling up through a long answer was thrown to the bottom mid-read.
 *
 * - The new window starts inside the old one: keep the older part the reader
 *   may be looking at, then the new window.
 * - The new window reaches further back than the old one but overlaps it: the
 *   new window alone, which holds everything the old one did.
 * - No message in common: there is a gap, so nothing can be continued.
 */
export function continueWindow(
  current: readonly ChatMessage[],
  latest: readonly ChatMessage[]
): ChatMessage[] | null {
  if (current.length === 0 || latest.length === 0) return null;
  const first = latest[0]!.id;
  const start = current.findIndex((message) => message.id === first);
  if (start >= 0) return [...current.slice(0, start), ...latest];
  const ids = new Set(latest.map((message) => message.id));
  return current.some((message) => ids.has(message.id)) ? [...latest] : null;
}
