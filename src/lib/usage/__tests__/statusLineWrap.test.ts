import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { parseUsageFile } from '../planUsage';
import {
  isEmptySettings,
  isWrapped,
  originalFileText,
  originalFromWrapper,
  parseOriginal,
  unwrapSettings,
  WRAPPER_COMMAND,
  wrapperScript,
  wrapSettings,
} from '../statusLineWrap';

const ccstatusline = { type: 'command', command: 'npx -y ccstatusline@latest', padding: 0 };
const settings = JSON.stringify({ model: 'opus', hooks: { Stop: [] }, statusLine: ccstatusline }, null, 2);

describe('the settings file', () => {
  it('puts the wrapper in the status line, keeps every other setting, and hands back the one it replaced', () => {
    const edit = wrapSettings(settings);
    if (!edit.ok) throw new Error(edit.message);
    expect(edit.original).toEqual(ccstatusline);
    expect(JSON.parse(edit.settings)).toEqual({
      model: 'opus', hooks: { Stop: [] }, statusLine: { type: 'command', command: WRAPPER_COMMAND, padding: 0 },
    });
    expect(isWrapped(edit.settings)).toBe(true);
    expect(isWrapped(settings)).toBe(false);
  });

  it('wraps a host with no settings file or no status line, with nothing to put back', () => {
    for (const text of [null, '', '{"model":"opus"}']) {
      const edit = wrapSettings(text);
      expect(edit.ok && edit.original).toBeNull();
      expect(edit.ok && isWrapped(edit.settings)).toBe(true);
    }
  });

  // Wrapping twice would save the wrapper as the status line to put back.
  it('changes nothing when already wrapped', () => {
    const once = wrapSettings(settings);
    if (!once.ok) throw new Error(once.message);
    expect(wrapSettings(once.settings)).toEqual({ ok: true, settings: once.settings, original: null });
  });

  // Rewriting a file it could not read would lose every setting in it.
  it('refuses settings that are not JSON, rather than replacing them', () => {
    expect(wrapSettings('{ "model": "opus", // a comment\n}')).toEqual(expect.objectContaining({ ok: false, code: 'settings_unreadable' }));
    expect(wrapSettings('[]')).toEqual(expect.objectContaining({ ok: false }));
    expect(unwrapSettings('nope', null)).toEqual(expect.objectContaining({ ok: false }));
  });

  it('puts the saved status line back, or removes the wrapper when there was none', () => {
    const wrapped = wrapSettings(settings);
    if (!wrapped.ok) throw new Error(wrapped.message);
    const restored = unwrapSettings(wrapped.settings, wrapped.original);
    expect(restored.ok && JSON.parse(restored.settings)).toEqual(JSON.parse(settings));
    const none = unwrapSettings(JSON.stringify({ model: 'opus', statusLine: { type: 'command', command: WRAPPER_COMMAND } }), null);
    expect(none.ok && JSON.parse(none.settings)).toEqual({ model: 'opus' });
  });

  // Someone who set another status line since chose it: leave it.
  it('leaves a status line the person changed since', () => {
    expect(unwrapSettings(settings, { type: 'command', command: 'echo old' })).toEqual({ ok: true, settings, original: null });
  });

  // "No status line" puts back none; "can't tell" must never read as that.
  it('reads the saved status line back, and tells none from a file it cannot read', () => {
    expect(parseOriginal(originalFileText({ statusLine: ccstatusline, createdSettings: false })))
      .toEqual({ statusLine: ccstatusline, createdSettings: false });
    expect(parseOriginal(originalFileText({ statusLine: null, createdSettings: true })))
      .toEqual({ statusLine: null, createdSettings: true });
    for (const unknown of [null, '', 'garbage', '{}', '{"statusLine":"echo"}', JSON.stringify(ccstatusline)]) {
      expect(parseOriginal(unknown)).toBeNull();
    }
  });

  it('recovers the status line from the wrapper, with the fields the wrapped settings kept', () => {
    const wrapped = wrapSettings(settings);
    if (!wrapped.ok) throw new Error(wrapped.message);
    const quoted = { type: 'command', command: "printf '%s\\n' \"it's\"\necho two" };
    expect(originalFromWrapper(wrapperScript(ccstatusline), wrapped.settings)).toEqual({ statusLine: ccstatusline, createdSettings: false });
    expect(originalFromWrapper(wrapperScript(quoted), '{}')?.statusLine).toEqual(quoted);
    expect(originalFromWrapper(wrapperScript(null), wrapped.settings)).toEqual({ statusLine: null, createdSettings: false });
    expect(originalFromWrapper('#!/bin/sh\necho someone else', wrapped.settings)).toBeNull();
  });

  it('knows settings that say nothing', () => {
    expect(isEmptySettings('{}\n')).toBe(true);
    expect(isEmptySettings('{"model":"opus"}')).toBe(false);
    expect(isEmptySettings('nope')).toBe(false);
  });
});

describe('the wrapper, run by sh as Claude Code runs it', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'herdrchat-statusline-'));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const status = {
    session_id: 's1',
    model: { display_name: "Opus 5.5 'quoted' %s" },
    rate_limits: { five_hour: { used_percentage: 20, resets_at: 4102444800 }, seven_day: { used_percentage: 38, resets_at: 4102444800 } },
  };
  const run = (original: Record<string, unknown> | null) => {
    const script = join(home, 'statusline.sh');
    writeFileSync(script, wrapperScript(original));
    return execFileSync('sh', [script], { input: JSON.stringify(status), env: { ...process.env, HOME: home }, encoding: 'utf8' });
  };

  it('saves the input as the usage file the app reads', () => {
    run(null);
    const usage = parseUsageFile(readFileSync(join(home, '.cache/herdrchat/usage.json'), 'utf8'), 1792861200);
    expect(usage).toEqual(expect.objectContaining({
      fiveHour: { percentLeft: 80, resetsAt: 4102444800 },
      sevenDay: { percentLeft: 62, resetsAt: 4102444800 },
    }));
  });

  it('runs the status line it replaced with the same input, and prints what it prints', () => {
    // A stand-in for ccstatusline: reads stdin like it, and quotes in the command survive.
    const out = run({ type: 'command', command: `sed -n 's/.*"session_id":"\\([^"]*\\)".*/session \\1 it'"'"'s mine/p'` });
    expect(out.trim()).toBe("session s1 it's mine");
  });

  it('prints nothing without a status line to run', () => {
    expect(run({ type: 'command', command: '  ' })).toBe('');
  });
});
