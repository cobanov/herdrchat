import { attachCommand, needsNewerHerdr, noBackslashes, paneKind } from '../command';

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
  // The Computers tab: no herdr pane, the computer's own login shell.
  it('opens a login shell on the host', () => {
    const login = { paneId: '', kind: 'login' as const, terminalId: null, herdrPath: 'herdr', session: 'work' };
    expect(attachCommand(login)).toBe(`${LOCALE}; exec "\${SHELL:-/bin/sh}" -l`);
  });

  it('attaches an agent pane on the host with herdr agent attach', () => {
    expect(attachCommand({ paneId: 'w2:p1', kind: 'agent', terminalId: 'term_a', herdrPath: 'herdr', session: '' })).toBe(
      `${PATH_PREFIX}${LOCALE}; exec 'herdr' 'agent' 'attach' 'w2:p1'`
    );
    // The terminal id is not needed for an agent pane.
    expect(attachCommand({ paneId: 'w2:p1', kind: 'agent', terminalId: null, herdrPath: 'herdr', session: '' })).toBe(
      `${PATH_PREFIX}${LOCALE}; exec 'herdr' 'agent' 'attach' 'w2:p1'`
    );
  });

  // Privately: no zoom, no session attach, nothing another client sees.
  it('attaches a shell pane by its terminal id, alone, without zooming or attaching the session', () => {
    const command = attachCommand({ paneId: 'w6:p2', kind: 'shell', terminalId: 'term_65d8', herdrPath: 'herdr', session: 'default' });
    expect(command).toBe(`${PATH_PREFIX}${LOCALE}; exec 'herdr' 'terminal' 'attach' 'term_65d8'`);
    expect(command).not.toContain('zoom');
    expect(command).not.toContain('session');
  });

  it('takes over only when asked, on either attach', () => {
    const shell = { paneId: 'w6:p2', kind: 'shell', terminalId: 'term_65d8', herdrPath: 'herdr', session: '' } as const;
    expect(attachCommand(shell)).not.toContain('--takeover');
    expect(attachCommand({ ...shell, takeover: false })).not.toContain('--takeover');
    expect(attachCommand({ ...shell, takeover: true })).toBe(`${PATH_PREFIX}${LOCALE}; exec 'herdr' 'terminal' 'attach' 'term_65d8' '--takeover'`);
    expect(attachCommand({ ...shell, kind: 'agent', takeover: true })).toBe(`${PATH_PREFIX}${LOCALE}; exec 'herdr' 'agent' 'attach' 'w6:p2' '--takeover'`);
  });

  // An older herdr's snapshot: no private attach exists, and nothing shared
  // is put in its place.
  it('has no command for a shell pane without a terminal id', () => {
    expect(attachCommand({ paneId: 'w6:p2', kind: 'shell', terminalId: null, herdrPath: 'herdr', session: '' })).toBeNull();
    expect(attachCommand({ paneId: 'w6:p2', kind: 'shell', terminalId: '', herdrPath: 'herdr', session: '' })).toBeNull();
    expect(needsNewerHerdr({ kind: 'shell', terminalId: null })).toBe(true);
    expect(needsNewerHerdr({ kind: 'shell', terminalId: 'term_1' })).toBe(false);
    expect(needsNewerHerdr({ kind: 'agent', terminalId: null })).toBe(false);
  });

  it('exports a named session for the attach', () => {
    const command = attachCommand({ paneId: 'w6:p2', kind: 'shell', terminalId: 'term_1', herdrPath: '~/.local/bin/herdr', session: ' work ' });
    expect(command).toContain(`export HERDR_SESSION='work'; `);
    expect(command).toMatch(/exec "\$HOME"\/'\.local\/bin\/herdr' 'terminal' 'attach' 'term_1'$/);
  });

  it('never writes a backslash, even for a quote in the session', () => {
    const command = attachCommand({ paneId: 'w1:p1', kind: 'shell', terminalId: 'term_1', herdrPath: 'herdr', session: "kenneth's" });
    expect(command).not.toContain('\\');
    expect(command).toContain(`export HERDR_SESSION='kenneth'"'"'s'`);
  });

  it('refuses what it cannot write without a backslash', () => {
    expect(attachCommand({ paneId: 'w1:p1', kind: 'agent', terminalId: null, herdrPath: 'herdr', session: 'a\\b' })).toBeNull();
    expect(attachCommand({ paneId: 'w1\\p1', kind: 'agent', terminalId: null, herdrPath: 'herdr', session: null })).toBeNull();
    expect(attachCommand({ paneId: 'w1:p1', kind: 'shell', terminalId: 'term\\1', herdrPath: 'herdr', session: null })).toBeNull();
  });

});

describe('noBackslashes', () => {
  it('writes a quoted quote without a backslash', () => {
    expect(noBackslashes(`'it'\\''s'`)).toBe(`'it'"'"'s'`);
  });
});

/**
 * The command as it really runs: typed by herdr-ssh into the login shell as
 * ` exec /bin/sh -c '<marker>; <command>'` (ShellLaunch.swift), with a fake
 * `herdr` first on the PATH that `withPath` builds from HOME.
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
    chmodSync(`${home}/.local/bin/herdr`, 0o755);
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
    it(`attaches a shell pane under ${shell}, with the session and the locale, and runs nothing else`, () => {
      const output = run(shell, attachCommand({
        paneId: 'w6:p2', kind: 'shell', terminalId: 'term_65d8', herdrPath: 'herdr', session: "it's", takeover: true,
      })!);
      // The marker, then the attach's own drawing.
      expect(output).toBe('HERDRCHAT_SHELL_ab12\n{"result":{}}\n');
      expect(log('herdr.log')).toEqual(["session=it's", 'lang=en_US.UTF-8', 'terminal', 'attach', 'term_65d8', '--takeover']);
    });

  }
});
