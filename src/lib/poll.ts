import type { HerdrErrorCode } from './herdr/protocol';

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

/**
 * Failures that no retry can fix, only the user: the host refused these
 * credentials, the key is not on the device, or the host key changed.
 *
 * Polling on through them only adds failed logins. OpenSSH penalises a source
 * address for those (PerSourcePenalties), and together with pre-auth
 * connections left open it refused the phone outright during the simulator
 * acceptance pass. A loop that hits one pauses until the user pulls to refresh
 * or edits the host, which replaces the client and so restarts the loop.
 */
export function needsTheUser(code: HerdrErrorCode | null | undefined): boolean {
  return (
    code === 'auth_failed' || code === 'host_key_changed' || code === 'credentials_missing' || code === 'bad_key'
  );
}

/** The open thread's status poll, while something on screen is changing. */
export const STATUS_POLL_MS = 2000;

/**
 * The status poll's rate while the host's event stream is live and nothing
 * calls for the fast one. Status flips and turn ends arrive as events and
 * trigger a poll at once; this only catches what a dropped stream would lose.
 */
export const LIVE_POLL_MS = 30_000;

/**
 * Whether the thread's poll must keep the fast rate even with the host's
 * events live, because what it watches changes with no event to say so.
 *
 * - `working`: the streaming preview and the tail watchdog are screen reads.
 * - `blocked`: a question can change under an agent that stays blocked (the
 *   next of several, then the review screen). At the idle rate the answered
 *   question stayed up for half a minute.
 * - `watchingPanel`: a slash command's panel is open over the idle agent.
 * - `agentsRunning`: Claude Code's agents pane, last read, had a running row.
 *   Claude idles while its background agents run, so herdr says `idle`, and a
 *   finished agent is only a redrawn row. At the idle rate the bar said
 *   "working" up to half a minute after the last one finished.
 */
export function pollsFast({
  working,
  blocked,
  watchingPanel,
  agentsRunning,
}: {
  working: boolean;
  blocked: boolean;
  watchingPanel: boolean;
  agentsRunning: boolean;
}): boolean {
  return working || blocked || watchingPanel || agentsRunning;
}

/**
 * The thread's poll interval before any backoff: the slow rate only when the
 * event stream is live and nothing calls for the fast one (`pollsFast`).
 * Without the stream the poll is the only way to notice anything, so it stays
 * fast. `pollScale` is the user's setting, which slows the fast rate.
 */
export function statusPollMs({
  streamLive,
  fast,
  pollScale,
}: {
  streamLive: boolean;
  fast: boolean;
  pollScale: number;
}): number {
  return streamLive && !fast ? LIVE_POLL_MS : STATUS_POLL_MS * pollScale;
}
