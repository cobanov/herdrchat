import { canReconnect, phaseLabel, phaseMessage, type TerminalPhase } from '../status';

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
});

it('explains an ending that is not just the pane closing', () => {
  expect(phaseMessage(closed('exited', 0))).toBeNull();
  expect(phaseMessage(closed('exited', 127))).toMatch(/herdr isn't installed/);
  expect(phaseMessage(closed('exited', 1))).toMatch(/could not attach/);
  expect(phaseMessage(closed('connection_lost'))).toMatch(/dropped/);
  expect(phaseMessage(closed('transport_failed', null, 'Channel refused'))).toBe('Channel refused');
  expect(phaseMessage({ kind: 'failed', message: 'Host unreachable' })).toBe('Host unreachable');
  expect(phaseMessage({ kind: 'open' })).toBeNull();
});
