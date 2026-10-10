import { DEMO_SHELL_SCREEN, demoTerminalScreen } from '@/lib/demo/terminal';
import { JUMP_CONNECT_TIMEOUT_MS, TERMINAL_START_TIMEOUT_MS } from '@/lib/herdr/timeouts';
import { demoConnection, machineConnection, newConnection } from '@/state/connections';
import { terminalLaunch } from '../target';

// The connection helpers are what is under test; the native module behind
// their transport never loads in Jest.
jest.mock('../../../../modules/herdr-ssh/src/HerdrSshModule', () => ({}));

const host = { ...newConnection(), id: 'srv-1', name: 'Gimel', host: 'gimel', herdrPath: '/opt/homebrew/bin/herdr', sessionName: 'work' };
const klaw = machineConnection(host, { id: 'm-klaw', label: 'klaw', target: 'klaw', session: 'default', enabled: true });

it("opens a host pane's terminal on the host, with its herdr and its session", () => {
  const launch = terminalLaunch(host, 'w6:p2', 'shell');
  expect(launch).toEqual(expect.objectContaining({ hostId: 'srv-1', startTimeoutMs: TERMINAL_START_TIMEOUT_MS }));
  expect(launch?.command).toContain("'/opt/homebrew/bin/herdr' 'session' 'attach' 'work'");
  expect(launch?.command).toContain("export HERDR_SESSION='work'");
  expect(launch?.command).not.toContain('ssh ');
});

// A machine has no SSH connection of its own: the shell is opened on its
// host's, and runs the jump, with the machine's session and `herdr` by name.
it("opens a machine pane's terminal on its host's connection, through the jump", () => {
  const launch = terminalLaunch(klaw, 'w1:p1', 'agent');
  expect(launch?.hostId).toBe('srv-1');
  expect(launch?.startTimeoutMs).toBe(TERMINAL_START_TIMEOUT_MS + JUMP_CONNECT_TIMEOUT_MS);
  expect(launch?.command).toContain('ssh -t -e none');
  expect(launch?.command).toContain("-- 'klaw'");
  expect(launch?.command).toMatch(/agent.*attach.*w1:p1/);
  expect(launch?.command).not.toContain('/opt/homebrew/bin/herdr');
});

it('opens nothing for a pane id that cannot be passed without a backslash', () => {
  expect(terminalLaunch(host, 'w6:p\\2', 'shell')).toBeNull();
});

// The Demo's recording is found by the very command the screen built, so a
// change to either side that drifts them apart shows here, not as a blank
// terminal in the screenshots.
it("finds the Demo's recorded screen for the command it builds", () => {
  const launch = terminalLaunch(demoConnection(), 'w6:p3', 'shell');
  expect(launch?.hostId).toBe('demo');
  expect(launch === null ? null : demoTerminalScreen(launch.command, launch.host)).toBe(DEMO_SHELL_SCREEN);
});
