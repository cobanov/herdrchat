import { sshJump } from '../../herdr/machine';
import { JUMP_CONNECT_TIMEOUT_MS, TERMINAL_START_TIMEOUT_MS } from '../../herdr/timeouts';
import {
  attachCommand,
  leaveShellPane,
  noBackslashes,
  paneKind,
  ptyJump,
  terminalStartTimeout,
  unzoomCommand,
  zoomedOn,
} from '../command';

const { execFileSync } = jest.requireActual<typeof import('node:child_process')>('node:child_process');
const { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } =
  jest.requireActual<typeof import('node:fs')>('node:fs');
const { tmpdir } = jest.requireActual<typeof import('node:os')>('node:os');

const PATH_PREFIX = 'export PATH="$HOME/.local/bin:$HOME/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"; ';
const LOCALE = 'export LANG="${LANG:-en_US.UTF-8}"';

describe('paneKind', () => {
  it('attaches any detected agent as an agent, and a pane with none as a shell', () => {
    expect(paneKind('claude')).toBe('agent');
    expect(paneKind('letta')).toBe('agent');
    expect(paneKind(null)).toBe('shell');
  });
});

describe('attachCommand', () => {
  it('attaches an agent pane on the host with herdr agent attach', () => {
    expect(attachCommand({ paneId: 'w2:p1', kind: 'agent', herdrPath: 'herdr', session: '' })).toBe(
      `${PATH_PREFIX}${LOCALE}; exec 'herdr' 'agent' 'attach' 'w2:p1'`
    );
  });

  it('zooms a shell pane and attaches its session, the default one when none is named', () => {
    expect(attachCommand({ paneId: 'w6:p2', kind: 'shell', herdrPath: 'herdr', session: 'default' })).toBe(
      `${PATH_PREFIX}${LOCALE}; 'herdr' pane zoom --pane 'w6:p2' --on >/dev/null 2>&1; exec 'herdr' 'session' 'attach' 'default'`
    );
  });

  it('exports a named session for both the zoom and the attach', () => {
    const command = attachCommand({ paneId: 'w6:p2', kind: 'shell', herdrPath: '~/.local/bin/herdr', session: ' work ' });
    expect(command).toContain(`export HERDR_SESSION='work'; `);
    expect(command).toContain(`"$HOME"/'.local/bin/herdr' pane zoom`);
    expect(command).toMatch(/exec "\$HOME"\/'\.local\/bin\/herdr' 'session' 'attach' 'work'$/);
  });

  it('never writes a backslash, even for a quote in the session', () => {
    const command = attachCommand({ paneId: 'w1:p1', kind: 'shell', herdrPath: 'herdr', session: "kenneth's" });
    expect(command).not.toContain('\\');
    expect(command).toContain(`export HERDR_SESSION='kenneth'"'"'s'`);
  });

  it('refuses what it cannot write without a backslash', () => {
    expect(attachCommand({ paneId: 'w1:p1', kind: 'agent', herdrPath: 'herdr', session: 'a\\b' })).toBeNull();
    expect(attachCommand({ paneId: 'w1\\p1', kind: 'agent', herdrPath: 'herdr', session: null })).toBeNull();
    expect(
      attachCommand({ paneId: 'w1:p1', kind: 'agent', herdrPath: 'herdr', session: null, machine: { target: 'a\\b' } })
    ).toBeNull();
  });

  it('jumps a machine pane through the host with a terminal and no escape character', () => {
    const command = attachCommand({
      paneId: 'w1:p1',
      kind: 'agent',
      herdrPath: '/opt/herdr',
      session: 'bots',
      machine: { target: 'klaw' },
    });
    expect(command).not.toBeNull();
    expect(command!.startsWith(`${PATH_PREFIX}ssh -t -e none -o BatchMode=yes `)).toBe(true);
    expect(command).toContain(` -- 'klaw' '`);
    // The machine's herdr is found by name there; the host's path is the host's.
    expect(command).not.toContain('/opt/herdr');
    expect(command).not.toContain('\\');
  });
});

describe('ptyJump', () => {
  it('is sshJump with -t and -e none, so the same options reach the machine', () => {
    expect(ptyJump('klaw', 'x')).toBe(`ssh -t -e none ${sshJump('klaw', 'x').slice('ssh '.length)}`);
  });
});

describe('noBackslashes', () => {
  it('writes a quoted quote without a backslash', () => {
    expect(noBackslashes(`'it'\\''s'`)).toBe(`'it'"'"'s'`);
  });
});

describe('terminalStartTimeout', () => {
  it('adds the jump connect time for a machine', () => {
    expect(terminalStartTimeout({})).toBe(TERMINAL_START_TIMEOUT_MS);
    expect(terminalStartTimeout({ machine: { target: 'klaw' } })).toBe(TERMINAL_START_TIMEOUT_MS + JUMP_CONNECT_TIMEOUT_MS);
  });
});

describe('leaving a shell pane', () => {
  it('undoes the zoom the app made and gives focus back', () => {
    expect(leaveShellPane('w6:p2', { zoomed: false, focusedPaneId: 'w6:p1' })).toEqual({
      unzoom: unzoomCommand('w6:p2'),
      refocus: { method: 'pane.focus', params: { pane_id: 'w6:p1' } },
    });
  });

  it("keeps a zoom the person had, and a focus that never moved", () => {
    expect(leaveShellPane('w6:p2', { zoomed: true, focusedPaneId: 'w6:p2' })).toEqual({ unzoom: null, refocus: null });
    expect(leaveShellPane('w6:p2', { zoomed: false, focusedPaneId: null }).refocus).toBeNull();
  });

  it('passes the pane as --pane, which herdr requires', () => {
    expect(unzoomCommand('w6:p2')).toBe(`${PATH_PREFIX}'herdr' 'pane' 'zoom' '--pane' 'w6:p2' '--off'`);
  });

  it('reads a zoom from the tab holding the pane, focused on it', () => {
    const layouts = [
      { focusedPaneId: 'w1:p1', zoomed: true, panes: [{ paneId: 'w1:p1' }, { paneId: 'w1:p2' }] },
      { focusedPaneId: 'w6:p2', zoomed: false, panes: [{ paneId: 'w6:p2' }] },
    ];
    expect(zoomedOn(layouts, 'w1:p1')).toBe(true);
    expect(zoomedOn(layouts, 'w1:p2')).toBe(false);
    expect(zoomedOn(layouts, 'w6:p2')).toBe(false);
    expect(zoomedOn(null, 'w6:p2')).toBe(false);
  });
});

/**
 * The command as it really runs: typed by herdr-ssh into the login shell as
 * ` exec /bin/sh -c '<marker>; <command>'` (ShellLaunch.swift), with a fake
 * `herdr` and a fake `ssh` first on the PATH that `withPath` builds from HOME.
 */
describe('under real login shells', () => {
  let home = '';
  beforeEach(() => {
    home = mkdtempSync(`${tmpdir()}/hc-term-`);
    mkdirSync(`${home}/.local/bin`, { recursive: true });
    const herdr = [
      '#!/bin/sh',
      `printf '%s\\n' "session=$HERDR_SESSION" "lang=$LANG" "$@" >> "$HOME/herdr.log"`,
      `echo '{"result":{}}'`,
      '',
    ].join('\n');
    writeFileSync(`${home}/.local/bin/herdr`, herdr);
    // ssh as a stand-in: logs its options, drops them, the `--` and the
    // destination, and hands the rest to `sh -c` as sshd hands it to a login shell.
    const ssh = [
      '#!/bin/sh',
      `printf '%s\\n' "$@" > "$HOME/ssh.log"`,
      'while [ "$1" != "--" ]; do shift; done',
      'shift; shift',
      'exec sh -c "$*"',
      '',
    ].join('\n');
    writeFileSync(`${home}/.local/bin/ssh`, ssh);
    chmodSync(`${home}/.local/bin/herdr`, 0o755);
    chmodSync(`${home}/.local/bin/ssh`, 0o755);
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  /** ShellLaunch.line, minus the Return. */
  const launchLine = (command: string) => {
    const script = `echo HERDRCHAT_""SHELL_ab12; ${command}`;
    return ` exec /bin/sh -c '${script.replaceAll("'", `'\\''`)}'`;
  };
  const run = (shell: string, command: string) =>
    execFileSync(shell, ['-c', launchLine(command)], { encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin', HOME: home, LANG: '' } });
  const log = (name: string) => readFileSync(`${home}/${name}`, 'utf8').trimEnd().split('\n');

  for (const shell of ['/bin/zsh', '/bin/bash', '/bin/dash'].filter((path) => existsSync(path))) {
    it(`attaches a shell pane under ${shell}, with the session and the locale`, () => {
      const output = run(shell, attachCommand({ paneId: 'w6:p2', kind: 'shell', herdrPath: 'herdr', session: "it's" })!);
      // The marker, then the attach's own drawing: zoom's reply goes nowhere.
      expect(output).toBe('HERDRCHAT_SHELL_ab12\n{"result":{}}\n');
      expect(log('herdr.log')).toEqual([
        "session=it's", 'lang=en_US.UTF-8', 'pane', 'zoom', '--pane', 'w6:p2', '--on',
        "session=it's", 'lang=en_US.UTF-8', 'session', 'attach', "it's",
      ]);
    });

    it(`attaches a machine's agent pane through the host's ssh under ${shell}`, () => {
      run(shell, attachCommand({
        paneId: 'w1:p1', kind: 'agent', herdrPath: 'herdr', session: "o'k", machine: { target: 'klaw' },
      })!);
      const ssh = log('ssh.log');
      expect(ssh.slice(0, 3)).toEqual(['-t', '-e', 'none']);
      expect(ssh).toContain('BatchMode=yes');
      expect(ssh[ssh.indexOf('--') + 1]).toBe('klaw');
      expect(log('herdr.log')).toEqual(["session=o'k", 'lang=en_US.UTF-8', 'agent', 'attach', 'w1:p1']);
    });
  }
});
