import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GEMINI_HOOK_NAME, GEMINI_HOOK_SCRIPT, installGeminiHook } from '../herdr/geminiHook';
import type { HerdrTransport } from '../herdr/transport';

const log = '/home/dev/.gemini/tmp/app/chats/session-2026-10-16T09-00-1a2b3c4d.jsonl';
let dir: string;
let hook: string;
let calls: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'herdrchat-gemini-hook-'));
  hook = join(dir, 'gemini-session-hook.sh');
  calls = join(dir, 'calls');
  writeFileSync(hook, GEMINI_HOOK_SCRIPT, { mode: 0o755 });
  // A herdr that writes down what it was asked, one argument a line.
  writeFileSync(join(dir, 'herdr'), `#!/bin/sh\nprintf '%s\\n' "$@" >> '${calls}'\necho noise; echo more noise >&2; exit 3\n`, { mode: 0o755 });
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** Run the hook as Gemini CLI does: the event as JSON on stdin, the pane's environment. */
function runHook(input: string, env: Record<string, string> = {}) {
  return spawnSync('/bin/sh', [hook], {
    input,
    encoding: 'utf8',
    // Never the herdr of a pane this test may run in.
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}`, HERDR_BIN_PATH: '', HERDR_ENV: '1', HERDR_PANE_ID: 'w3:p1', ...env },
  });
}
const reported = () => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : []);

describe('the Gemini session hook', () => {
  it('reports the log as the pane\'s session, and prints nothing for Gemini to read', () => {
    const run = runHook(JSON.stringify({ session_id: 's', transcript_path: log, hook_event_name: 'SessionStart', source: 'resume' }));
    expect([run.status, run.stdout, run.stderr]).toEqual([0, '', '']);
    const argv = reported();
    expect(argv.slice(0, 8)).toEqual(['pane', 'report-agent-session', 'w3:p1', '--source', 'herdrchat:gemini', '--agent', 'gemini', '--seq']);
    expect(argv[8]).toMatch(/^\d{19}$/);
    // The path alone: with an id too, herdr would expose the id.
    expect(argv.slice(9)).toEqual(['--agent-session-path', log, '--session-start-source', 'resume']);
  });

  it('reports before a prompt too, through the herdr the pane names', () => {
    const named = join(dir, 'named-herdr');
    writeFileSync(named, `#!/bin/sh\necho named >> '${calls}'\n`, { mode: 0o755 });
    runHook(JSON.stringify({ transcript_path: log, hook_event_name: 'BeforeAgent' }), { HERDR_BIN_PATH: named });
    expect(reported()).toEqual(['named']);
    runHook(JSON.stringify({ transcript_path: log, hook_event_name: 'BeforeAgent' }));
    expect(reported().slice(1).filter((arg) => arg.startsWith('--session-start'))).toEqual([]);
  });

  it('does nothing, and fails nothing, outside a herdr pane or without a log', () => {
    for (const [input, env] of [
      [JSON.stringify({ transcript_path: log }), { HERDR_ENV: '' }],
      [JSON.stringify({ transcript_path: log }), { HERDR_PANE_ID: '' }],
      // At SessionStart the log may not exist yet: Gemini sends an empty path.
      [JSON.stringify({ transcript_path: '' }), {}],
      [JSON.stringify({ transcript_path: '/home/dev/notes.txt' }), {}],
      ['not json', {}],
      ['[]', {}],
    ] as const) {
      const run = runHook(input, env);
      expect([run.status, run.stdout]).toEqual([0, '']);
    }
    expect(reported()).toEqual([]);
  });

  it('gives up on a herdr that hangs, rather than holding Gemini up', () => {
    writeFileSync(join(dir, 'herdr'), '#!/bin/sh\nsleep 5\n', { mode: 0o755 });
    const started = Date.now();
    const run = runHook(JSON.stringify({ transcript_path: log }));
    expect(run.status).toBe(0);
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe('installing the Gemini hook', () => {
  /** The host, a shell with its own home. */
  let home: string;
  const transport: HerdrTransport = {
    exec: async (command) => {
      const run = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8', env: { ...process.env, HOME: home, GEMINI_CLI_HOME: '' } });
      return { ok: true, stdout: run.stdout, stderr: run.stderr, exitCode: run.status ?? 1 };
    },
    streamLines: async function* () {},
  };
  const settingsPath = () => join(home, '.gemini/settings.json');
  const settings = () => JSON.parse(readFileSync(settingsPath(), 'utf8')) as Record<string, unknown>;
  const installed = () => join(home, '.local/share/herdrchat/gemini-session-hook.sh');
  const ours = () => ({ hooks: [{ name: GEMINI_HOOK_NAME, type: 'command', command: installed(), timeout: 2000 }] });
  beforeEach(() => {
    home = join(dir, 'home dir');
    mkdirSync(join(home, '.gemini'), { recursive: true });
  });

  it('adds itself to SessionStart and BeforeAgent, keeps every other setting and hook, and backs the file up once', async () => {
    const theirs = { hooks: [{ name: 'lint', type: 'command', command: 'lint.sh' }], matcher: '*' };
    const original = `${JSON.stringify({ security: { auth: { selectedType: 'oauth' } }, hooks: { BeforeAgent: [theirs] } }, null, 4)}\n`;
    writeFileSync(settingsPath(), original, { mode: 0o600 });

    await installGeminiHook(transport);
    expect(readFileSync(installed(), 'utf8')).toBe(GEMINI_HOOK_SCRIPT);
    expect(statSync(installed()).mode & 0o777).toBe(0o755);
    // Quoted: Gemini runs the command with bash -c, and this home has a space.
    const expected = {
      security: { auth: { selectedType: 'oauth' } },
      hooks: { BeforeAgent: [theirs, { hooks: [{ ...ours().hooks[0], command: `'${installed()}'` }] }],
        SessionStart: [{ hooks: [{ ...ours().hooks[0], command: `'${installed()}'` }] }] },
    };
    expect(settings()).toEqual(expected);
    expect(statSync(settingsPath()).mode & 0o777).toBe(0o600);
    expect(readFileSync(`${settingsPath()}.herdrchat-bak`, 'utf8')).toBe(original);

    // Again: the same settings, and the backup is still the file as it was before HerdrChat.
    await installGeminiHook(transport);
    expect(settings()).toEqual(expected);
    expect(readFileSync(`${settingsPath()}.herdrchat-bak`, 'utf8')).toBe(original);
  });

  it('starts the settings when there are none', async () => {
    home = join(dir, 'fresh');
    await installGeminiHook(transport);
    expect(settings()).toEqual({ hooks: { SessionStart: [ours()], BeforeAgent: [ours()] } });
    expect(existsSync(`${settingsPath()}.herdrchat-bak`)).toBe(false);
  });

  it('writes through a symlinked settings file', async () => {
    const real = join(dir, 'dotfiles-settings.json');
    writeFileSync(real, '{"theme": "dark"}');
    symlinkSync(real, settingsPath());
    await installGeminiHook(transport);
    expect(JSON.parse(readFileSync(real, 'utf8'))).toMatchObject({ theme: 'dark', hooks: { BeforeAgent: [expect.anything()] } });
    expect(lstatSync(settingsPath()).isSymbolicLink()).toBe(true);
  });

  // Gemini takes comments in its settings; a JSON parser does not, and
  // rewriting the file would drop them. It is left as it is.
  it('refuses settings that are not plain JSON, and changes nothing', async () => {
    const original = '{\n  // my theme\n  "theme": "dark"\n}\n';
    writeFileSync(settingsPath(), original);
    await expect(installGeminiHook(transport)).rejects.toMatchObject({ code: 'gemini_settings_invalid' });
    expect(readFileSync(settingsPath(), 'utf8')).toBe(original);
    expect(existsSync(`${settingsPath()}.herdrchat-bak`)).toBe(false);
    writeFileSync(settingsPath(), '{"hooks": []}');
    await expect(installGeminiHook(transport)).rejects.toMatchObject({ code: 'gemini_settings_invalid' });
  });
});
