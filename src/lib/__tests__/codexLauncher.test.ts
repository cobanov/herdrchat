import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  const result = spawnSync('bash', [launcher], { encoding: 'utf8', env: { ...process.env,
    PATH: `${dir}:${process.env.PATH ?? ''}`, HERDR_ENV: '', HERDR_PANE_ID: '', HERDR_SOCKET_PATH: '' } });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('inside the Herdr pane');
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
