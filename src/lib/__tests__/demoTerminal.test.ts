import { HerdrClient } from '../herdr/client';
import { DemoHost } from '../demo/host';
import { DEMO_HOST } from '../demo/fixtures';
import {
  DEMO_SHELL_PROMPT,
  DEMO_SHELL_PROMPT_TEXT,
  DEMO_SHELL_SCREEN,
  demoAgentScreen,
  demoTerminalScreen,
} from '../demo/terminal';
import { attachCommand } from '../terminal/command';

/** What a terminal shows, without its escape sequences. */
const visible = (screen: string) => screen.replace(/\u001b\[[0-9;]*m/g, '');

describe("the Demo's shell pane", () => {
  it('is in the snapshot as a pane with no agent, beside the two agents of w6', async () => {
    const snapshot = await new HerdrClient(new DemoHost()).snapshot();
    const w6 = snapshot.panes.filter((pane) => pane.workspaceId === 'w6');
    expect(w6.map((pane) => [pane.paneId, pane.agent])).toEqual([['w6:p1', 'claude'], ['w6:p2', 'claude'], ['w6:p3', null]]);
    expect(w6[2]).toMatchObject({ cwd: '/home/demo/api', terminalId: 'term_w6_p3', title: null });
    // Not an agent: the chats and the event stream never see it.
    expect(snapshot.agents.some((agent) => agent.paneId === 'w6:p3')).toBe(false);
  });
});

describe('demoTerminalScreen', () => {
  const host = { herdrPath: 'herdr', session: '' };

  it("answers the shell pane's attach command with the recorded zsh session", () => {
    const command = attachCommand({ paneId: 'w6:p3', kind: 'shell', ...host })!;
    expect(demoTerminalScreen(command, host)).toBe(DEMO_SHELL_SCREEN);
  });

  it('shows a prompt in /home/demo/api, an ls and a coloured git status, ending at the prompt', () => {
    const text = visible(DEMO_SHELL_SCREEN);
    expect(text.startsWith(`${DEMO_SHELL_PROMPT_TEXT}ls\r\n`)).toBe(true);
    expect(text).toContain('migrations  package.json  src');
    expect(text).toContain(`${DEMO_SHELL_PROMPT_TEXT}git status\r\n`);
    expect(text).toContain('modified:   src/routes/projects.ts');
    expect(DEMO_SHELL_SCREEN).toContain('\u001b[31mmodified:');
    expect(DEMO_SHELL_SCREEN.endsWith(DEMO_SHELL_PROMPT)).toBe(true);
    // Every line ends as a terminal's does, or the next starts mid-row.
    expect(DEMO_SHELL_SCREEN.replaceAll('\r\n', '')).not.toContain('\n');
  });

  it("answers an agent pane's attach (the chat's Terminal action) with its input box", () => {
    const command = attachCommand({ paneId: 'w2:p1', kind: 'agent', ...host })!;
    expect(demoTerminalScreen(command, host)).toBe(demoAgentScreen('claude', '/home/demo/notes'));
    expect(visible(demoAgentScreen('claude', '/home/demo/notes'))).toContain('Claude');
  });

  it("answers a machine's pane through the jump, with the machine's session", () => {
    const machine = DEMO_HOST.machines[0]!;
    const command = attachCommand({
      paneId: 'w1:p1', kind: 'agent', herdrPath: 'herdr', session: machine.session, machine: { target: machine.target },
    })!;
    expect(demoTerminalScreen(command, host)).toBe(demoAgentScreen('claude', '/home/demo/kenneth-bot'));
  });

  it('answers nothing for a command no Demo pane is attached by', () => {
    expect(demoTerminalScreen(attachCommand({ paneId: 'w9:p9', kind: 'shell', ...host })!, host)).toBeNull();
    // The shell pane attached as an agent is not its command: herdr would refuse it.
    expect(demoTerminalScreen(attachCommand({ paneId: 'w6:p3', kind: 'agent', ...host })!, host)).toBeNull();
    expect(demoTerminalScreen('ls', host)).toBeNull();
  });
});
