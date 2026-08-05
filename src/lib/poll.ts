/**
 * When a poll loop should be running, and how fast.
 *
 * Two hooks poll this app's host — the chat list and the open thread — and both
 * used to run flat out, forever, regardless of anything. Three problems, all of
 * which cost battery and cellular data on a device that has neither to spare:
 *
 * The app kept polling while backgrounded. iOS suspends the timers anyway, but
 * the socket usually dies with them, so the first poll after a resume ran
 * against a dead connection.
 *
 * Both screens polled at once. Expo Router's native stack keeps a screen mounted
 * underneath a pushed one, and effect cleanup only runs on unmount — so opening
 * a conversation did not stop the list behind it.
 *
 * And nothing backed off. A host that was down got a failing SSH round-trip
 * every two seconds, indefinitely.
 *
 * This is pure arithmetic and a state machine, kept out of React so it can be
 * tested without one.
 */

/** Doubling, so a host that stays down settles into an occasional retry. */
export const BACKOFF_FACTOR = 2;

/**
 * Never wait longer than this between attempts, however long the host has been
 * unreachable. A minute is short enough that a host coming back is noticed
 * without the user thinking to pull to refresh.
 */
export const BACKOFF_CEILING_MS = 60_000;

/**
 * How long to wait before the next poll.
 *
 * `failures` counts *consecutive* failures and resets to zero on any success —
 * the reset is what stops one bad poll from slowing a healthy connection.
 */
export function backoffDelay(baseMs: number, failures: number): number {
  if (failures <= 0) return baseMs;
  const grown = baseMs * BACKOFF_FACTOR ** failures;
  return Math.min(grown, BACKOFF_CEILING_MS);
}

/**
 * Whether a loop should be polling at all right now.
 *
 * Backgrounded means nobody can see the result. Unfocused means a different
 * screen is on top and owns the refreshing — the thread's own poll covers what
 * the user is actually looking at, so the list underneath can wait.
 */
export function shouldPoll({
  active,
  focused,
}: {
  active: boolean;
  focused: boolean;
}): boolean {
  return active && focused;
}
