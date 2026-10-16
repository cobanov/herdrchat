import { DEMO_SHELL_SCREEN, demoTerminalScreen } from '@/lib/demo/terminal';
import { TERMINAL_START_TIMEOUT_MS } from '@/lib/herdr/timeouts';
import { demoConnection, newConnection } from '@/state/connections';
import { noLaunchMessage, terminalLaunch } from '../target';

// The connection helpers are what is under test; the native module behind
// their transport never loads in Jest.
jest.mock('../../../../modules/herdr-ssh/src/HerdrSshModule', () => ({}));

const host = { ...newConnection(), id: 'srv-1', name: 'Gimel', host: 'gimel', herdrPath: '/opt/homebrew/bin/herdr', sessionName: 'work' };

it("opens a host pane's terminal on the host, with its herdr, its session and its terminal id", () => {
  const launch = terminalLaunch(host, { paneId: 'w6:p2', kind: 'shell', terminalId: 'term_w6_p2' });
  expect(launch).toEqual(expect.objectContaining({ hostId: 'srv-1', startTimeoutMs: TERMINAL_START_TIMEOUT_MS }));
  expect(launch?.command).toContain("'/opt/homebrew/bin/herdr' 'terminal' 'attach' 'term_w6_p2'");
  expect(launch?.command).toContain("export HERDR_SESSION='work'");
  expect(launch?.command).not.toContain('ssh ');
  expect(launch?.command).not.toContain('--takeover');
});

it("takes the pane over only when asked", () => {
  const pane = { paneId: 'w6:p2', kind: 'shell', terminalId: 'term_w6_p2' } as const;
  expect(terminalLaunch(host, pane, true)?.command).toMatch(/'terminal' 'attach' 'term_w6_p2' '--takeover'$/);
  expect(terminalLaunch(host, { ...pane, kind: 'agent' }, true)?.command).toContain('--takeover');
});

// An older herdr's snapshot has no terminal id: the shell pane opens nothing,
// rather than the shared session view, and the screen says why.
it('opens nothing for a shell pane without a terminal id, and says it needs a newer herdr', () => {
  expect(terminalLaunch(host, { paneId: 'w6:p2', kind: 'shell', terminalId: null })).toBeNull();
  expect(noLaunchMessage({ kind: 'shell', terminalId: null })).toBe("This pane can't be opened on this herdr. It needs herdr 0.9 or newer.");
  expect(noLaunchMessage({ kind: 'agent', terminalId: null })).toMatch(/can't be passed to herdr safely/);
});

it('opens nothing for a pane id that cannot be passed without a backslash', () => {
  expect(terminalLaunch(host, { paneId: 'w6:p\\2', kind: 'agent', terminalId: null })).toBeNull();
});

// The Demo's recording is found by the very command the screen built, so a
// change to either side that drifts them apart shows here, not as a blank
// terminal in the screenshots.
it("finds the Demo's recorded screen for the command it builds", () => {
  const pane = { paneId: 'w6:p3', kind: 'shell', terminalId: 'term_w6_p3' } as const;
  const launch = terminalLaunch(demoConnection(), pane);
  expect(launch?.hostId).toBe('demo');
  expect(launch === null ? null : demoTerminalScreen(launch.command, launch.host)).toBe(DEMO_SHELL_SCREEN);
  const takeover = terminalLaunch(demoConnection(), pane, true);
  expect(takeover === null ? null : demoTerminalScreen(takeover.command, takeover.host)).toBe(DEMO_SHELL_SCREEN);
});
