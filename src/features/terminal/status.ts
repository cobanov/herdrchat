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
  | { kind: 'closed'; reason: ShellCloseReason; exitCode: number | null; message: string | null }
  | { kind: 'failed'; message: string };

/** Whether the header offers Reconnect: the shell is gone, by whatever way it went. */
export function canReconnect(phase: TerminalPhase): boolean {
  return phase.kind === 'closed' || phase.kind === 'failed';
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
      if (phase.reason === 'transport_failed') return 'Disconnected';
      // herdr's attach ends 0 when the pane closes or herdr detaches it.
      return phase.exitCode === null || phase.exitCode === 0 ? 'Ended' : `Ended with exit ${phase.exitCode}`;
  }
}

/**
 * What the banner under the header says, or null for nothing to explain.
 *
 * An attach that exits 127 at once found no herdr on the host; one that ends
 * with an error status otherwise is herdr refusing the pane (it closed, or the
 * session is gone). Both are said, since the screen itself would only show a
 * line of herdr's output, or nothing at all when the launch never got that far.
 */
export function phaseMessage(phase: TerminalPhase): string | null {
  if (phase.kind === 'failed') return phase.message;
  if (phase.kind !== 'closed') return null;
  if (phase.reason === 'connection_lost') return 'The connection to the host dropped. Reconnect to pick up where the pane is now.';
  if (phase.reason === 'transport_failed') return phase.message ?? 'The terminal channel failed.';
  if (phase.exitCode === 127) return "herdr isn't installed where this pane is, or isn't on the PATH.";
  if (phase.exitCode !== null && phase.exitCode !== 0) return 'herdr could not attach to this pane. It may have closed.';
  return null;
}
