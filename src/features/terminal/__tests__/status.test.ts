import { canReconnect, canTakeOver, phaseLabel, phaseMessage, type TerminalPhase } from '../status';

const closed = (reason: 'exited' | 'connection_lost' | 'transport_failed', exitCode: number | null = null, message: string | null = null): TerminalPhase =>
  ({ kind: 'closed', reason, exitCode, message });

it('says where the shell stands, and offers Reconnect only once it has gone', () => {
  expect([{ kind: 'waiting' } as const, { kind: 'opening' } as const, { kind: 'open' } as const].map((phase) => [phaseLabel(phase), canReconnect(phase)]))
    .toEqual([['Connecting…', false], ['Connecting…', false], ['Connected', false]]);
  expect(phaseLabel(closed('exited', 0))).toBe('Ended');
  expect(phaseLabel(closed('exited', 2))).toBe('Ended with exit 2');
  expect(phaseLabel(closed('connection_lost'))).toBe('Connection lost');
  expect(phaseLabel({ kind: 'failed', message: 'Host unreachable' })).toBe('Not connected');
  expect([closed('exited', 0), closed('connection_lost'), { kind: 'failed', message: 'x' } as const].every(canReconnect)).toBe(true);
  // Nothing to run (a herdr too old for a private attach): a Reconnect would do nothing.
  expect(canReconnect({ kind: 'failed', message: 'x', retryable: false })).toBe(false);
  expect(phaseLabel({ kind: 'failed', message: 'x', retryable: false })).toBe('Not connected');
});

it('explains an ending that is not just the pane closing', () => {
  expect(phaseMessage(closed('exited', 0))).toBeNull();
  expect(phaseMessage(closed('exited', 127))).toMatch(/herdr isn't installed/);
  expect(phaseMessage(closed('exited', 1))).toBe('herdr could not attach. Another client may be attached to this pane, or it may have closed.');
  expect(phaseMessage(closed('exited', 2))).toMatch(/could not attach to this pane/);
  expect(phaseMessage(closed('connection_lost'))).toMatch(/dropped/);
  expect(phaseMessage(closed('transport_failed', null, 'Channel refused'))).toBe('Channel refused');
  expect(phaseMessage({ kind: 'failed', message: 'Host unreachable' })).toBe('Host unreachable');
  expect(phaseMessage({ kind: 'open' })).toBeNull();
});

// Taking a pane from another client is the person's call: offered only when
// herdr refused the attach, which is how it says another client holds it.
it('offers Take over only for an attach herdr refused', () => {
  expect(canTakeOver(closed('exited', 1))).toBe(true);
  expect(canTakeOver(closed('exited', 0))).toBe(false);
  expect(canTakeOver(closed('exited', 127))).toBe(false);
  expect(canTakeOver(closed('exited', null))).toBe(false);
  expect(canTakeOver(closed('connection_lost', 1))).toBe(false);
  expect(canTakeOver(closed('transport_failed'))).toBe(false);
  expect([{ kind: 'open' } as const, { kind: 'opening' } as const, { kind: 'failed', message: 'x' } as const].some(canTakeOver)).toBe(false);
});
