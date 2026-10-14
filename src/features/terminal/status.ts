import type { ShellCloseReason } from '../../../modules/herdr-ssh/src';

/**
 * Where a pane's terminal stands. `waiting` is before the view has measured
 * itself: the shell is opened at the view's size in cells, so it cannot open
 * sooner.
 */
export type TerminalPhase =
  | { kind: 'waiting' }
  | { kind: 'opening' }
  | { kind: 'open' }
  /**
   * `background`: the app hung up as it went to the background (a locked
   * phone must not hold the attach, or keep the desktop pane at its size).
   */
  | { kind: 'closed'; reason: ShellCloseReason | 'background'; exitCode: number | null; message: string | null }
  /**
   * `retryable: false` when no command can be written for the pane (a herdr
   * too old to send a terminal id): Reconnect could only do nothing, and the
   * terminal id comes with the screen, so it could not succeed later either.
   */
  | { kind: 'failed'; message: string; retryable?: false };

/**
 * Whether the header offers Reconnect: the shell is gone, by whatever way it
 * went, and another try could open one.
 */
export function canReconnect(phase: TerminalPhase): boolean {
  return phase.kind === 'closed' || (phase.kind === 'failed' && phase.retryable !== false);
}

/**
 * Whether the header offers Take over: herdr refused the attach (exit 1),
 * which is what it does when another client holds the pane. Taking it from
 * that client is the person's call, never a retry the app makes on its own.
 */
export function canTakeOver(phase: TerminalPhase): boolean {
  return phase.kind === 'closed' && phase.reason === 'exited' && phase.exitCode === 1;
}

/** The header's status words. */
export function phaseLabel(phase: TerminalPhase): string {
  switch (phase.kind) {
    case 'waiting':
    case 'opening':
      return 'Connecting…';
    case 'open':
      return 'Connected';
    case 'failed':
      return 'Not connected';
    case 'closed':
      if (phase.reason === 'connection_lost') return 'Connection lost';
      if (phase.reason === 'background') return 'Hung up';
      if (phase.reason === 'transport_failed') return 'Disconnected';
      // herdr's attach ends 0 when the pane closes or herdr detaches it.
      return phase.exitCode === null || phase.exitCode === 0 ? 'Ended' : `Ended with exit ${phase.exitCode}`;
  }
}

/**
 * What the banner under the header says, or null for nothing to explain.
 *
 * An attach that exits 127 at once found no herdr on the host; one that exits
 * 1 is herdr refusing the pane, most often because another client is attached
 * to it (the header then offers Take over); another error status is the pane
 * or the session gone. Both are said, since the screen itself would only show a
 * line of herdr's output, or nothing at all when the launch never got that far.
 */
export function phaseMessage(phase: TerminalPhase): string | null {
  if (phase.kind === 'failed') return phase.message;
  if (phase.kind !== 'closed') return null;
  if (phase.reason === 'connection_lost') return 'The connection to the host dropped. Reconnect to pick up where the pane is now.';
  if (phase.reason === 'background') return 'Hung up while the app was in the background. Reconnect to pick up where the pane is now.';
  if (phase.reason === 'transport_failed') return phase.message ?? 'The terminal channel failed.';
  if (phase.exitCode === 127) return "herdr isn't installed where this pane is, or isn't on the PATH.";
  if (canTakeOver(phase)) return 'herdr could not attach. Another client may be attached to this pane, or it may have closed.';
  if (phase.exitCode !== null && phase.exitCode !== 0) return 'herdr could not attach to this pane. It may have closed.';
  return null;
}
