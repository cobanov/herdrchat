import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CODEX_LAUNCHER_SCRIPT } from '../herdr/codexLauncherScript';
import { installCodexLauncher } from '../herdr/codexLauncher';
import type { HerdrTransport } from '../herdr/transport';

const launcher = resolve(__dirname, '../../../scripts/herdr-codex.sh');
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'herdrchat-launcher-test-'));
  writeFileSync(join(dir, 'codex'), `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

it('embeds exactly the tested launcher for installation from the phone', () => {
  expect(CODEX_LAUNCHER_SCRIPT).toBe(readFileSync(launcher, 'utf8'));
});

it('refuses to overwrite an unrelated executable on the host', async () => {
  const transport: HerdrTransport = {
    exec: async () => ({ ok: true, stdout: '', stderr: '', exitCode: 47 }),
    streamLines: async function* () {},
  };
  await expect(installCodexLauncher(transport)).rejects.toMatchObject({ code: 'codex_launcher_conflict' });
});

it('carries only pane-scoped context and preserves caller arguments and safety settings', () => {
  const result = execFileSync('bash', [launcher, '--sandbox', 'read-only', '-a', 'never'], {
    encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}`,
      HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HERDR_SOCKET_PATH: '/path with spaces/herdr.sock' },
  });
  const args: unknown = JSON.parse(result);
  expect(args).toEqual([
    '-c', 'features.hooks=true',
    '-c', 'shell_environment_policy.set.HERDR_ENV="1"',
    '-c', 'shell_environment_policy.set.HERDR_PANE_ID="w1:p1"',
    '-c', 'shell_environment_policy.set.HERDR_SOCKET_PATH="/path with spaces/herdr.sock"',
    '--sandbox', 'read-only', '-a', 'never',
  ]);
  expect(result).not.toContain('dangerously');
});

it('refuses to start outside an identified Herdr pane', () => {
  const named = join(dir, 'herdrchat-codex');
  writeFileSync(named, CODEX_LAUNCHER_SCRIPT, { mode: 0o755 });
  const result = spawnSync('bash', [named], { encoding: 'utf8', env: { ...process.env,
    PATH: `${dir}:${process.env.PATH ?? ''}`, HERDR_ENV: '', HERDR_PANE_ID: '', HERDR_SOCKET_PATH: '' } });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('inside the Herdr pane');
});

it('normal codex forwards pane identity without recursing through managed aliases or duplicate PATH entries', () => {
  const shimDir = join(dir, 'shim');
  mkdirSync(shimDir);
  const shim = join(shimDir, 'codex');
  writeFileSync(shim, CODEX_LAUNCHER_SCRIPT, { mode: 0o755 });
  symlinkSync(shim, join(shimDir, 'herdrchat-codex'));
  const env = { ...process.env, PATH: `${shimDir}:${shimDir}:${dir}:/usr/bin:/bin`,
    HERDR_ENV: '1', HERDR_PANE_ID: 'w2:p1', HERDR_SOCKET_PATH: '/tmp/herdr.sock' };
  for (const entry of [shim, join(shimDir, 'herdrchat-codex')]) {
    const args: unknown = JSON.parse(execFileSync(entry, ['resume', 'exact-id'], { env, encoding: 'utf8' }));
    expect(args).toContain('shell_environment_policy.set.HERDR_PANE_ID="w2:p1"');
    expect(args).toEqual(expect.arrayContaining(['resume', 'exact-id']));
  }
});

it('leaves normal Codex outside Herdr unchanged', () => {
  const result = execFileSync('bash', [launcher, '--sandbox', 'read-only'], {
    encoding: 'utf8', env: { ...process.env, PATH: `${dir}:/usr/bin:/bin`,
      HERDR_ENV: '', HERDR_PANE_ID: '', HERDR_SOCKET_PATH: '' },
  });
  expect(JSON.parse(result)).toEqual(['--sandbox', 'read-only']);
});

it('installs both entry points, but does not overwrite an existing unrelated codex', async () => {
  const testRoot = join(dir, 'install-root');
  const bin = join(testRoot, '.local/bin');
  mkdirSync(bin, { recursive: true });
  const transport: HerdrTransport = {
    exec: async (command) => {
      const result = spawnSync('/bin/sh', ['-c', command.replaceAll('$HOME', testRoot)], { encoding: 'utf8' });
      return { ok: true, stdout: result.stdout, stderr: result.stderr, exitCode: result.status ?? 1 };
    },
    streamLines: async function* () {},
  };
  writeFileSync(join(bin, 'codex'), 'unrelated');
  await expect(installCodexLauncher(transport)).rejects.toMatchObject({ code: 'codex_launcher_conflict' });
  expect(readFileSync(join(bin, 'codex'), 'utf8')).toBe('unrelated');
  rmSync(join(bin, 'codex'));
  await installCodexLauncher(transport);
  await installCodexLauncher(transport);
  expect(readFileSync(join(bin, 'codex'), 'utf8')).toBe(CODEX_LAUNCHER_SCRIPT);
  expect(readFileSync(join(bin, 'herdrchat-codex'), 'utf8')).toBe(CODEX_LAUNCHER_SCRIPT);
});

it('fails clearly if PATH contains only the managed launcher', () => {
  const shim = join(dir, 'codex');
  writeFileSync(shim, CODEX_LAUNCHER_SCRIPT, { mode: 0o755 });
  const result = spawnSync('/bin/bash', [shim], {
    encoding: 'utf8', env: { ...process.env, PATH: dir, HERDR_ENV: '' },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('original Codex executable is not on PATH');
});

it('quotes unusual socket names without evaluating their shell syntax', () => {
  const socketPath = '/tmp/"$(echo INJECTED)"/sock';
  const result = execFileSync('bash', [launcher, 'resume', 'known-id'], { encoding: 'utf8', env: {
    ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}`, HERDR_ENV: '1',
    HERDR_PANE_ID: 'w1:p1', HERDR_SOCKET_PATH: socketPath,
  } });
  expect(JSON.parse(result)).toContain(`shell_environment_policy.set.HERDR_SOCKET_PATH=${JSON.stringify(socketPath)}`);
  expect(JSON.parse(result)).toEqual(expect.arrayContaining(['resume', 'known-id']));
});
