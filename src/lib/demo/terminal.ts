/**
 * The Demo's terminal.
 *
 * The Demo host has no SSH under it, so its terminal cannot attach to
 * anything. `openShell` on the Demo's connection opens the native echo shell
 * instead (herdr-ssh: what is typed comes back, cooked), and the screen feeds
 * it what the pane would have shown, from here: a recorded zsh session for the
 * shell pane, an agent's input box for an agent pane.
 *
 * Which pane is answered is read back from the attach command the screen
 * built, by building it again for every pane the Demo has and comparing, the
 * way the Demo unwraps a machine jump. A change to the builder then cannot
 * leave the Demo answering a command the app no longer sends: it answers
 * nothing, and the flow that opens the terminal fails.
 */
import { agentName } from '../herdr/models';
import { attachCommand, paneKind } from '../terminal/command';
import { DEMO_HOST, demoPanes, type DemoFixtures } from './fixtures';

const ESC = '\u001b';
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const RED = `${ESC}[31m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const BLUE_BOLD = `${ESC}[1;34m`;
const MAGENTA = `${ESC}[35m`;
const CRLF = '\r\n';

/** The zsh prompt in the Demo's shell pane, as it is drawn (colours included). */
export const DEMO_SHELL_PROMPT = `${GREEN}demo@devbox${RESET} ${BLUE_BOLD}~/api${RESET} ${YELLOW}(main)${RESET} % `;

/** The same prompt as a person reads it, for a test or a flow to look for. */
export const DEMO_SHELL_PROMPT_TEXT = 'demo@devbox ~/api (main) % ';

/**
 * The shell pane's screen: an `ls` in /home/demo/api and a coloured
 * `git status`, then a fresh prompt for the person to type at.
 */
export const DEMO_SHELL_SCREEN = [
  `${DEMO_SHELL_PROMPT}ls${CRLF}`,
  `README.md  ${BLUE_BOLD}migrations${RESET}  package.json  ${BLUE_BOLD}src${RESET}  ${BLUE_BOLD}tests${RESET}  tsconfig.json${CRLF}`,
  `${DEMO_SHELL_PROMPT}git status${CRLF}`,
  `On branch ${BOLD}main${RESET}${CRLF}`,
  `Changes not staged for commit:${CRLF}`,
  `  (use "git add <file>..." to update what will be committed)${CRLF}`,
  `${CRLF}`,
  `\t${RED}modified:   migrations/0042_archive_projects.sql${RESET}${CRLF}`,
  `\t${RED}modified:   src/routes/projects.ts${RESET}${CRLF}`,
  `${CRLF}`,
  `Untracked files:${CRLF}`,
  `  (use "git add <file>..." to include in what will be committed)${CRLF}`,
  `\t${RED}tests/archive.test.ts${RESET}${CRLF}`,
  `${CRLF}`,
  `${GREEN}no changes added to commit${RESET} (use "git add" and/or "git commit -a")${CRLF}`,
  DEMO_SHELL_PROMPT,
].join('');

/** An agent pane's screen: its own input box, as its terminal UI draws it, waiting. */
export function demoAgentScreen(agent: string | null, cwd: string): string {
  const name = agentName(agent);
  return [
    `${MAGENTA}✻${RESET} ${BOLD}${name}${RESET}${CRLF}`,
    `${DIM}  cwd: ${cwd}${RESET}${CRLF}`,
    `${CRLF}`,
    `${DIM}────────────────────────────────────────${RESET}${CRLF}`,
    `> ${CRLF}`,
    `${DIM}────────────────────────────────────────${RESET}${CRLF}`,
    `${DIM}  ? for shortcuts${RESET}${CRLF}`,
  ].join('');
}

/** How the screen addressed the Demo: its connection's herdr path and session. */
export interface DemoTerminalHost {
  herdrPath: string;
  session: string | null | undefined;
}

/**
 * What the Demo's terminal shows for `command`, or null when it is not the
 * attach command of any pane the Demo has, on the host or one of its machines.
 */
export function demoTerminalScreen(
  command: string,
  host: DemoTerminalHost = { herdrPath: 'herdr', session: null },
  fixtures: DemoFixtures = DEMO_HOST
): string | null {
  const own = screenOn(command, fixtures, (paneId, kind) =>
    attachCommand({ paneId, kind, herdrPath: host.herdrPath, session: host.session })
  );
  if (own !== null) return own;
  for (const machine of fixtures.machines) {
    const screen = screenOn(command, machine.fixtures, (paneId, kind) =>
      attachCommand({ paneId, kind, herdrPath: 'herdr', session: machine.session, machine: { target: machine.target } })
    );
    if (screen !== null) return screen;
  }
  return null;
}

function screenOn(
  command: string,
  fixtures: DemoFixtures,
  build: (paneId: string, kind: 'agent' | 'shell') => string | null
): string | null {
  for (const workspace of fixtures.workspaces) {
    for (const pane of demoPanes(workspace)) {
      const agent = pane.agent ?? 'claude';
      if (build(pane.paneId, paneKind(agent)) === command) return demoAgentScreen(agent, pane.cwd);
    }
    for (const pane of workspace.shellPanes ?? []) {
      if (build(pane.paneId, 'shell') === command) return DEMO_SHELL_SCREEN;
    }
  }
  return null;
}
