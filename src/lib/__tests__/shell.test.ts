import { execFileSync } from 'node:child_process';

import { commandWord, shellCommand, untilChannelCloses, shellQuote } from '../herdr/shell';

describe('commandWord (#106)', () => {
  it('expands a leading ~/ to $HOME and keeps the rest quoted', () => {
    expect(commandWord('~/.local/bin/herdr')).toBe(`"$HOME"/'.local/bin/herdr'`);
    expect(commandWord("~/we'ird dir/herdr")).toBe(`"$HOME"/'we'\\''ird dir/herdr'`);
  });

  it('leaves every other path exactly quoted', () => {
    expect(commandWord('/opt/herdr')).toBe(`'/opt/herdr'`);
    expect(commandWord('herdr')).toBe(`'herdr'`);
    expect(commandWord('~user/herdr')).toBe(`'~user/herdr'`);
  });

  it('resolves under a real shell', () => {
    const out = execFileSync('sh', ['-c', `printf '%s' ${commandWord('~/bin/x')}`], {
      encoding: 'utf8',
      env: { ...process.env, HOME: '/home/someone' },
    });
    expect(out).toBe('/home/someone/bin/x');
  });

  it('treats only the program word that way', () => {
    expect(shellCommand(['~/herdr', 'pane', '~/not-a-program'])).toBe(`"$HOME"/'herdr' 'pane' '~/not-a-program'`);
  });
});

// A stopped stream used to leave its command running on the host: sshd keeps
// the session while the child lives, and a quiet `tail -f` never learns.
describe('untilChannelCloses', () => {
  const { spawn, execFileSync: exec } = jest.requireActual<typeof import('node:child_process')>('node:child_process');
  const { mkdtempSync, readFileSync, existsSync, rmSync } = jest.requireActual<typeof import('node:fs')>('node:fs');
  const { tmpdir } = jest.requireActual<typeof import('node:os')>('node:os');
  const shells = ['sh', 'bash', 'zsh', 'dash'].filter((shell) => {
    try {
      exec('sh', ['-c', `command -v ${shell}`]);
      return true;
    } catch {
      return false;
    }
  });
  const running = (marker: string) => {
    try {
      return exec('pgrep', ['-f', marker], { encoding: 'utf8' }).trim().length > 0;
    } catch {
      return false;
    }
  };
  const run = (shell: string, command: string) => {
    const child = spawn(shell, ['-c', untilChannelCloses(command)], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    return { child, exited, output: () => out };
  };
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it.each(shells)('%s: stops the command when the channel closes, and lets its cleanup run', async (shell) => {
    const dir = mkdtempSync(`${tmpdir()}/hc-close-`);
    const marker = `${1000 + Math.floor(Math.random() * 8000)}.${shells.indexOf(shell) + 1}`;
    try {
      const { child, exited } = run(shell, `sleep ${marker}; echo cleaned > ${shellQuote(`${dir}/done`)}`);
      await pause(400);
      expect(running(`sleep ${marker}`)).toBe(true);
      child.stdin.end();
      await Promise.race([exited, pause(5_000)]);
      await pause(200);
      expect(running(`sleep ${marker}`)).toBe(false);
      expect(existsSync(`${dir}/done`) && readFileSync(`${dir}/done`, 'utf8').trim()).toBe('cleaned');
    } finally {
      exec('sh', ['-c', `pkill -f "sleep ${marker}"; true`]);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(shells)('%s: ends with the command, keeping its output and exit status', async (shell) => {
    const { exited, output } = run(shell, 'echo hi; exit 3');
    expect(await Promise.race([exited, pause(5_000).then(() => 'hung')])).toBe(3);
    expect(output()).toBe('hi\n');
  });
});
