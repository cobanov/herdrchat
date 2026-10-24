import { spawnSync, execFileSync } from 'child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { ExecResult } from '../../../../modules/herdr-ssh/src';
import { DemoHost } from '../../demo/host';
import { DEMO_USAGE } from '../../demo/scenarios';
import type { HerdrTransport } from '../../herdr/transport';
import { USAGE_FILE } from '../planUsage';
import { ORIGINAL_FILE, SETTINGS_FILE, WRAPPER_COMMAND, WRAPPER_FILE } from '../statusLineWrap';
import {
  fetchPlanUsage,
  installPlan,
  installUsageStatusLine,
  parseStatusLineRead,
  parseUsageRead,
  parseWriteResult,
  removeUsageStatusLine,
  statusLineReadCommand,
  USAGE_BEGIN,
  USAGE_MISSING,
} from '../usageClient';

const ccstatusline = { type: 'command', command: 'npx -y ccstatusline@latest', padding: 0 };
const settings = `${JSON.stringify({ model: 'opus', hooks: { Stop: [] }, statusLine: ccstatusline }, null, 2)}\n`;
const FAR = 4102444800;
const status = { session_id: 's1', rate_limits: { five_hour: { used_percentage: 20, resets_at: FAR }, seven_day: { used_percentage: 38, resets_at: FAR } } };

const stream = async function* () {
  yield* [];
};

/** A transport that runs each command with `sh` against a home folder of its own, as a host would. */
function shellHost(home: string, before?: (command: string) => void): HerdrTransport & { commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    exec: async (command): Promise<ExecResult> => {
      commands.push(command);
      before?.(command);
      const run = spawnSync('sh', ['-c', command], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
      return { ok: true, exitCode: run.status ?? 1, stdout: run.stdout, stderr: run.stderr };
    },
    streamLines: stream,
  };
}

const canned = (answers: ExecResult[]): HerdrTransport => ({
  exec: async () => answers.shift() ?? { ok: false, code: 'transport_failed', message: 'no more answers' },
  streamLines: stream,
});

describe('reading usage', () => {
  it('reads the file, no file, and refuses output it does not print', () => {
    const file = JSON.stringify({ captured_at: 100, status });
    expect(parseUsageRead(`${USAGE_BEGIN}\n${file}`, 200)).toEqual({
      usage: { capturedAt: 100, fiveHour: { percentLeft: 80, resetsAt: FAR }, sevenDay: { percentLeft: 62, resetsAt: FAR } },
    });
    expect(parseUsageRead(`${USAGE_MISSING}\n`, 200)).toEqual({ usage: null });
    // An API-key session: a file, but nothing to show.
    expect(parseUsageRead(`${USAGE_BEGIN}\n{"captured_at":1,"status":{}}`, 200)).toEqual({ usage: null });
    expect(parseUsageRead('bash: sh: command not found', 200)).toBeNull();
  });

  // A failed read keeps what the footer shows, so it must never throw.
  it('answers null when the host does not', async () => {
    expect(await fetchPlanUsage(canned([{ ok: false, code: 'timeout', message: 'slow' }]), 0)).toBeNull();
    expect(await fetchPlanUsage(canned([{ ok: true, exitCode: 1, stdout: '', stderr: '' }]), 0)).toBeNull();
    const throwing: HerdrTransport = { exec: async () => { throw new Error('boom'); }, streamLines: stream };
    expect(await fetchPlanUsage(throwing, 0)).toBeNull();
  });

  // The Demo shows usage from the start, with resets always ahead of now.
  it('reads the Demo host’s usage', async () => {
    const now = 1_800_000_000_000;
    const read = await fetchPlanUsage(new DemoHost(() => now), now / 1000);
    expect(read?.usage?.sevenDay).toEqual({ percentLeft: 100 - DEMO_USAGE.sevenDay.usedPercentage, resetsAt: now / 1000 + DEMO_USAGE.sevenDay.resetsInSeconds });
    expect(read?.usage?.fiveHour?.percentLeft).toBe(100 - DEMO_USAGE.fiveHour.usedPercentage);
    expect(read?.usage?.capturedAt).toBe(now / 1000);
  });
});

describe('the read of the settings', () => {
  it('tells a missing file from an empty one, and keeps a file byte for byte', () => {
    const home = mkdtempSync(join(tmpdir(), 'herdrchat-usage-read-'));
    try {
      const read = () => parseStatusLineRead(execFileSync('sh', ['-c', statusLineReadCommand()], { env: { ...process.env, HOME: home }, encoding: 'utf8' }));
      expect(read()).toEqual({ settings: { kind: 'none' }, original: { kind: 'none' }, wrapper: { kind: 'none' } });
      mkdirSync(join(home, '.claude'));
      writeFileSync(join(home, SETTINGS_FILE), '');
      expect(read()?.settings).toEqual(expect.objectContaining({ kind: 'present', text: '' }));
      writeFileSync(join(home, SETTINGS_FILE), '{"a":1}');
      expect(read()?.settings).toEqual(expect.objectContaining({ kind: 'present', text: '{"a":1}' }));
      writeFileSync(join(home, SETTINGS_FILE), '{"a":1}\n\n');
      expect(read()?.settings).toEqual(expect.objectContaining({ kind: 'present', text: '{"a":1}\n\n' }));
      // A directory where the file should be is not something to replace.
      rmSync(join(home, SETTINGS_FILE));
      mkdirSync(join(home, SETTINGS_FILE));
      expect(read()?.settings).toEqual({ kind: 'unreadable' });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('refuses output the command does not print', () => {
    expect(parseStatusLineRead('')).toBeNull();
    expect(parseStatusLineRead('@@herdrchat:settings begin 1 2\n{}')).toBeNull();
    expect(parseStatusLineRead('@@herdrchat:settings none\n')).toBeNull();
  });
});

describe('installing and taking out, run by sh against a home folder', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'herdrchat-usage-'));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const file = (path: string) => join(home, path);
  const read = (path: string) => readFileSync(file(path), 'utf8');
  const writeSettings = (text: string) => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(file(SETTINGS_FILE), text);
  };

  it('wraps the status line, saves usage when Claude runs it, and puts everything back', async () => {
    writeSettings(settings);
    const host = shellHost(home);
    expect(await installUsageStatusLine(host)).toEqual({ ok: true });
    expect(JSON.parse(read(SETTINGS_FILE))).toEqual({
      model: 'opus', hooks: { Stop: [] }, statusLine: { type: 'command', command: WRAPPER_COMMAND, padding: 0 },
    });
    expect(JSON.parse(read(ORIGINAL_FILE))).toEqual({ statusLine: ccstatusline, createdSettings: false });
    expect(ORIGINAL_FILE.startsWith('.cache/')).toBe(false);
    // Nothing left beside the files it moved into place.
    expect(existsSync(file(`${WRAPPER_FILE}.new`)) || existsSync(file(`${SETTINGS_FILE}.new`))).toBe(false);

    // Claude Code runs the status line command; the wrapper saves the usage.
    // The PATH has no npx, so the wrapped ccstatusline only fails to start.
    const wrapper = JSON.parse(read(SETTINGS_FILE)).statusLine.command as string;
    spawnSync('sh', ['-c', wrapper], {
      input: JSON.stringify(status), env: { ...process.env, HOME: home, PATH: '/usr/bin:/bin' },
    });
    const usage = await fetchPlanUsage(host, 200);
    expect(usage?.usage?.sevenDay?.percentLeft).toBe(62);

    expect(await removeUsageStatusLine(host)).toEqual({ ok: true });
    expect(JSON.parse(read(SETTINGS_FILE))).toEqual(JSON.parse(settings));
    for (const gone of [WRAPPER_FILE, ORIGINAL_FILE, USAGE_FILE]) expect(existsSync(file(gone))).toBe(false);
    expect(await fetchPlanUsage(host, 200)).toEqual({ usage: null });
  });

  // Turning off once left `{}` behind on a host that had no settings at all.
  it('sets up a host with no settings file, and takes it out again without leaving one', async () => {
    const host = shellHost(home);
    expect(await installUsageStatusLine(host)).toEqual({ ok: true });
    expect(JSON.parse(read(SETTINGS_FILE))).toEqual({ statusLine: { type: 'command', command: WRAPPER_COMMAND } });
    expect(JSON.parse(read(ORIGINAL_FILE))).toEqual({ statusLine: null, createdSettings: true });
    expect(await removeUsageStatusLine(host)).toEqual({ ok: true });
    expect(existsSync(file(SETTINGS_FILE))).toBe(false);
  });

  // Claude Code saved a setting of its own in the file the install created.
  it('keeps a settings file it created once something else is in it', async () => {
    const host = shellHost(home);
    await installUsageStatusLine(host);
    const wrapped = JSON.parse(read(SETTINGS_FILE)) as Record<string, unknown>;
    writeFileSync(file(SETTINGS_FILE), JSON.stringify({ ...wrapped, model: 'opus' }));
    expect(await removeUsageStatusLine(host)).toEqual({ ok: true });
    expect(JSON.parse(read(SETTINGS_FILE))).toEqual({ model: 'opus' });
  });

  // The saved status line was the only copy outside the wrapper, under a
  // folder cleaners empty: with it gone, Turn off deleted the status line.
  it('puts the status line back from the wrapper when the saved one is gone or garbled', async () => {
    for (const damage of [() => rmSync(file(ORIGINAL_FILE)), () => writeFileSync(file(ORIGINAL_FILE), 'not json')]) {
      writeSettings(settings);
      const host = shellHost(home);
      await installUsageStatusLine(host);
      damage();
      expect(await removeUsageStatusLine(host)).toEqual({ ok: true });
      expect(JSON.parse(read(SETTINGS_FILE))).toEqual(JSON.parse(settings));
    }
  });

  // A second phone, or a reinstall, on a host already wrapped.
  it('installs again on a wrapped host whose saved status line is gone, and saves it again', async () => {
    writeSettings(settings);
    const host = shellHost(home);
    await installUsageStatusLine(host);
    rmSync(file(ORIGINAL_FILE));
    expect(await installUsageStatusLine(host)).toEqual({ ok: true });
    expect(read(WRAPPER_FILE)).toContain('ccstatusline');
    expect(JSON.parse(read(ORIGINAL_FILE))).toEqual({ statusLine: ccstatusline, createdSettings: false });
  });

  it('writes nothing when neither the saved status line nor the wrapper can be read', async () => {
    writeSettings(settings);
    const host = shellHost(home);
    await installUsageStatusLine(host);
    const wrapped = read(SETTINGS_FILE);
    rmSync(join(home, '.cache'), { recursive: true });
    rmSync(file(ORIGINAL_FILE));
    expect(await removeUsageStatusLine(host)).toEqual(expect.objectContaining({ ok: false, code: 'original_missing' }));
    expect(await installUsageStatusLine(host)).toEqual(expect.objectContaining({ ok: false, code: 'original_missing' }));
    expect(read(SETTINGS_FILE)).toBe(wrapped);
    expect(existsSync(file(WRAPPER_FILE))).toBe(false);
  });

  // Rewriting a file it could not read would lose every setting in it.
  it('refuses settings that are not JSON, and writes nothing at all', async () => {
    const commented = '{ "model": "opus", // mine\n}';
    writeSettings(commented);
    const host = shellHost(home);
    expect(await installUsageStatusLine(host)).toEqual(expect.objectContaining({ ok: false, code: 'settings_unreadable' }));
    expect(host.commands).toHaveLength(1);
    expect(read(SETTINGS_FILE)).toBe(commented);
    expect(existsSync(file(WRAPPER_FILE))).toBe(false);
  });

  // Installing twice would save the wrapper as the status line to put back.
  it('installs twice without losing the status line it saved', async () => {
    writeSettings(settings);
    const host = shellHost(home);
    await installUsageStatusLine(host);
    const wrapped = read(SETTINGS_FILE);
    expect(await installUsageStatusLine(host)).toEqual({ ok: true });
    expect(read(SETTINGS_FILE)).toBe(wrapped);
    expect(JSON.parse(read(ORIGINAL_FILE))).toEqual({ statusLine: ccstatusline, createdSettings: false });
    expect(read(WRAPPER_FILE)).toContain('ccstatusline');
    await removeUsageStatusLine(host);
    expect(JSON.parse(read(SETTINGS_FILE))).toEqual(JSON.parse(settings));
  });

  // Claude Code saving its settings between the read and the write.
  it('writes nothing over settings that changed since it read them', async () => {
    writeSettings(settings);
    const changed = `${JSON.stringify({ model: 'sonnet', statusLine: ccstatusline })}\n`;
    let reads = 0;
    const host = shellHost(home, (command) => {
      if (command.includes('@@herdrchat:settings')) reads += 1;
      else if (reads > 0) writeFileSync(file(SETTINGS_FILE), changed);
    });
    expect(await installUsageStatusLine(host)).toEqual(expect.objectContaining({ ok: false, code: 'settings_changed' }));
    expect(read(SETTINGS_FILE)).toBe(changed);
  });

  it('leaves a status line the person set since alone, and still cleans up', async () => {
    writeSettings(settings);
    const host = shellHost(home);
    await installUsageStatusLine(host);
    const theirs = `${JSON.stringify({ statusLine: { type: 'command', command: 'echo mine' } })}\n`;
    writeFileSync(file(SETTINGS_FILE), theirs);
    expect(await removeUsageStatusLine(host)).toEqual({ ok: true });
    expect(read(SETTINGS_FILE)).toBe(theirs);
    expect(existsSync(file(WRAPPER_FILE))).toBe(false);
  });

  // Settings kept in a dotfiles repository and linked into place stay linked.
  it('writes through a symlinked settings file', async () => {
    const dotfiles = join(home, 'dotfiles');
    mkdirSync(dotfiles);
    writeFileSync(join(dotfiles, 'settings.json'), settings);
    mkdirSync(join(home, '.claude'));
    symlinkSync(join(dotfiles, 'settings.json'), file(SETTINGS_FILE));
    const host = shellHost(home);
    expect(await installUsageStatusLine(host)).toEqual({ ok: true });
    expect(lstatSync(file(SETTINGS_FILE)).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(dotfiles, 'settings.json'), 'utf8')).toContain(WRAPPER_COMMAND);
    expect(await removeUsageStatusLine(host)).toEqual({ ok: true });
    expect(lstatSync(file(SETTINGS_FILE)).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(join(dotfiles, 'settings.json'), 'utf8'))).toEqual(JSON.parse(settings));
    expect(readdirSync(dotfiles)).toEqual(['settings.json']);
  });

  // Written through the link, the target was emptied before the new text went
  // in, so a write that failed left it cut short.
  it('leaves a symlinked settings file whole when the write fails', async () => {
    const dotfiles = join(home, 'dotfiles');
    mkdirSync(dotfiles);
    writeFileSync(join(dotfiles, 'settings.json'), settings);
    mkdirSync(join(home, '.claude'));
    symlinkSync(join(dotfiles, 'settings.json'), file(SETTINGS_FILE));
    chmodSync(dotfiles, 0o555);
    try {
      const result = await installUsageStatusLine(shellHost(home));
      expect(result).toEqual(expect.objectContaining({ ok: false, code: 'command_failed' }));
      expect(readFileSync(join(dotfiles, 'settings.json'), 'utf8')).toBe(settings);
    } finally {
      chmodSync(dotfiles, 0o755);
    }
  });
});

describe('failures', () => {
  it('passes a transport failure through with its own message', async () => {
    expect(await installUsageStatusLine(canned([{ ok: false, code: 'timeout', message: "The host didn't answer in time." }])))
      .toEqual({ ok: false, code: 'timeout', message: "The host didn't answer in time." });
  });

  it('says what a script that exited badly wrote', async () => {
    expect(await installUsageStatusLine(canned([{ ok: true, exitCode: 2, stdout: '', stderr: 'sh: cksum: not found\n' }])))
      .toEqual({ ok: false, code: 'command_failed', message: "HerdrChat couldn't read Claude's settings on this host: sh: cksum: not found." });
    expect(parseWriteResult('', 1, 'sh: /home/u/.claude/settings.json.new: Permission denied\n'))
      .toEqual({ ok: false, code: 'command_failed', message: "HerdrChat couldn't write Claude's settings on this host: sh: /home/u/.claude/settings.json.new: Permission denied." });
    expect(parseWriteResult('', 1, '')).toEqual(expect.objectContaining({ message: "HerdrChat couldn't write Claude's settings on this host (exit 1)." }));
  });

  it('treats output it does not recognise as a failure', async () => {
    expect(await installUsageStatusLine(canned([{ ok: true, exitCode: 0, stdout: 'Welcome to Ubuntu\n', stderr: '' }])))
      .toEqual(expect.objectContaining({ ok: false, code: 'unexpected_output' }));
    expect(parseWriteResult('', 0, '')).toEqual(expect.objectContaining({ ok: false, code: 'unexpected_output' }));
  });

  it('plans no write for unreadable settings', () => {
    expect(installPlan({ settings: { kind: 'unreadable' }, original: { kind: 'none' }, wrapper: { kind: 'none' } }))
      .toEqual(expect.objectContaining({ ok: false, code: 'settings_unreadable' }));
  });
});
