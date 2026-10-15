import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterFetch,
  deserializeThemeFile,
  knownVersion,
  parseThemeFetch,
  serializeThemeFile,
  THEME_BEGIN,
  THEME_MISSING,
  THEME_NOT_FILE,
  THEME_TOO_LARGE,
  THEME_UNREADABLE,
  themeFetchCommand,
  themeResetCommand,
} from '../theme/hostTheme';
import type { HostThemeFile } from '../theme/resolve';
import { THEME_MAX_BYTES } from '../theme/schema';

describe('parseThemeFetch', () => {
  it('reads an unchanged file as unchanged', () => {
    expect(parseThemeFetch('3015617425 6\n', '3015617425 6')).toEqual({ kind: 'unchanged' });
  });

  it('reads a changed file with its contents, byte for byte', () => {
    const text = '{\n  "accent": "#123456"\n}\n';
    expect(parseThemeFetch(`7 25\n${THEME_BEGIN}\n${text}`, '6 25')).toEqual({ kind: 'present', version: '7 25', text });
    expect(parseThemeFetch(`5 0\n${THEME_BEGIN}\n`, null)).toEqual({ kind: 'present', version: '5 0', text: '' });
  });

  it('reads a missing file as missing, whatever was held before', () => {
    expect(parseThemeFetch(`${THEME_MISSING}\n`, null)).toEqual({ kind: 'missing' });
    // Removed after having existed: the theme goes back to the app's own.
    const held: HostThemeFile = { kind: 'present', version: '9 2', text: '{}' };
    const result = parseThemeFetch(`${THEME_MISSING}\n`, knownVersion(held));
    expect(afterFetch(held, result!)).toEqual({ kind: 'missing' });
  });

  it('reads each file it will not read as what it is', () => {
    expect(parseThemeFetch(`${THEME_UNREADABLE}\n`, null)).toEqual({ kind: 'unreadable', reason: 'permissions', version: null });
    expect(parseThemeFetch(`${THEME_NOT_FILE}\n`, null)).toEqual({ kind: 'unreadable', reason: 'notFile', version: null });
    expect(parseThemeFetch(`7 65537\n${THEME_TOO_LARGE}\n`, null)).toEqual({ kind: 'unreadable', reason: 'tooLarge', version: '7 65537' });
  });

  // Anything the command does not print is a failed check, not "no theme":
  // a failed check keeps the theme it has.
  it.each([
    '',
    'bash: cksum: command not found\n',
    'Welcome to Ubuntu\n1 2\n',
    '1700000000\n', // a whole-second mtime, as the old command printed
    '1 2\n', // just a version, but not the one held: the contents went missing
    `1 2\nsomething else\n`,
    `${THEME_MISSING}\nmore\n`,
    `${THEME_NOT_FILE}\nmore\n`,
  ])('reads %j as a failed check', (stdout) => {
    expect(parseThemeFetch(stdout, '1 1')).toBeNull();
  });

  it('keeps the held file on unchanged', () => {
    const held: HostThemeFile = { kind: 'present', version: '9 2', text: '{}' };
    expect(afterFetch(held, { kind: 'unchanged' })).toBe(held);
  });

  it('sends the version of a file it has fingerprinted', () => {
    expect(knownVersion({ kind: 'present', version: '9 0', text: '' })).toBe('9 0');
    expect(knownVersion({ kind: 'unreadable', reason: 'tooLarge', version: '9 70000' })).toBe('9 70000');
    expect(knownVersion({ kind: 'unreadable', reason: 'permissions', version: null })).toBeNull();
    expect(knownVersion({ kind: 'missing' })).toBeNull();
  });
});

describe('the fetch command', () => {
  // The read is bounded: a huge file, a FIFO or /dev/zero once grew the
  // buffered output until the timeout dropped the host's whole SSH client.
  it('reads only a regular file, and never more than the bound', () => {
    const command = themeFetchCommand(null);
    expect(command).toContain('[ ! -f "$f" ]');
    expect(command).toContain(`head -c ${THEME_MAX_BYTES + 1} "$f" | cksum`);
    expect(command).toContain(`head -c ${THEME_MAX_BYTES} "$f"`);
    expect(command).not.toMatch(/\bcat\b/);
    expect(THEME_MAX_BYTES).toBe(65_536);
  });

  it('sends a held version, and nothing it could not have printed', () => {
    expect(themeFetchCommand('12 34')).toContain('"$v" = "12 34"');
    expect(themeFetchCommand('mtime 1700000000')).toContain('"$v" = "mtime 1700000000"');
    expect(themeFetchCommand('1"; rm -rf ~; "')).toContain('"$v" = "-"');
  });
});

describe('the stored file', () => {
  it.each<HostThemeFile>([
    { kind: 'missing' },
    { kind: 'unreadable', reason: 'permissions', version: null },
    { kind: 'unreadable', reason: 'tooLarge', version: '3 70000' },
    { kind: 'present', version: '4 13', text: '{"name": "x"}\n' },
  ])('round-trips %j', (file) => {
    expect(deserializeThemeFile(serializeThemeFile(file))).toEqual(file);
  });

  // A row from before versions: kept, and fetched again in full by the next
  // check, since no host prints this version.
  it('reads a row stored with a whole-second mtime', () => {
    expect(deserializeThemeFile('{"kind":"present","mtime":4,"text":"{}"}')).toEqual({ kind: 'present', version: 'mtime 4', text: '{}' });
    expect(deserializeThemeFile('{"kind":"unreadable","mtime":4}')).toEqual({ kind: 'unreadable', reason: 'permissions', version: null });
  });

  it.each([null, undefined, '', 'nope', '{"kind":"present","mtime":"4","text":""}', '{"kind":"other"}', '{"kind":"unreadable"}', '7'])('refuses %j', (text) => {
    expect(deserializeThemeFile(text)).toBeNull();
  });
});

// The commands run by a real shell, on whichever `stat` this machine has (GNU
// on CI, BSD on a Mac), which is the portability the command claims.
describe('the commands in a real shell', () => {
  let home: string;
  const dir = () => join(home, '.herdrchat');
  const file = () => join(dir(), 'theme.json');
  const run = (command: string) => execFileSync('sh', ['-c', command], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  const fetch = (last: string | null) => parseThemeFetch(run(themeFetchCommand(last)), last);

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'herdrchat-fetch-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('follows a file from missing to present to unchanged to changed to removed', () => {
    expect(fetch(null)).toEqual({ kind: 'missing' });

    mkdirSync(dir());
    const text = "{ \"name\": \"it's \\\"quoted\\\"\" }\n";
    writeFileSync(file(), text);
    const first = fetch(null);
    expect(first).toMatchObject({ kind: 'present', text });
    const version = first!.kind === 'present' ? first!.version : '';
    expect(version).toMatch(new RegExp(`^\\d+ ${Buffer.byteLength(text)}$`));

    expect(fetch(version)).toEqual({ kind: 'unchanged' });
    expect(run(themeFetchCommand(version))).toBe(`${version}\n`);

    expect(fetch('1 1')).toEqual({ kind: 'present', version, text });

    rmSync(file());
    expect(fetch(version)).toEqual({ kind: 'missing' });
  });

  // A whole-second mtime missed a second write within the same second: the
  // phone kept the first until a Reload.
  it('sees a second write within the same second, even of the same length', () => {
    mkdirSync(dir());
    const when = new Date('2026-01-01T00:00:00Z');
    writeFileSync(file(), '{"name": "A"}');
    utimesSync(file(), when, when);
    const first = fetch(null);
    writeFileSync(file(), '{"name": "B"}');
    utimesSync(file(), when, when);
    const held = first!.kind === 'present' ? first!.version : null;
    expect(fetch(held)).toMatchObject({ kind: 'present', text: '{"name": "B"}' });
  });

  it('says when it cannot read the file', () => {
    if (process.getuid?.() === 0) return; // root reads anything
    mkdirSync(dir());
    writeFileSync(file(), '{}');
    chmodSync(file(), 0o000);
    expect(fetch(null)).toEqual({ kind: 'unreadable', reason: 'permissions', version: null });
    chmodSync(file(), 0o600);
  });

  it('never reads what is not a regular file: a directory, a FIFO, a link to /dev/zero', () => {
    mkdirSync(file(), { recursive: true });
    expect(fetch(null)).toEqual({ kind: 'unreadable', reason: 'notFile', version: null });
    rmSync(file(), { recursive: true });
    execFileSync('mkfifo', [file()]);
    // Reading a FIFO with no writer blocks forever; the command must not try.
    expect(fetch(null)).toEqual({ kind: 'unreadable', reason: 'notFile', version: null });
    rmSync(file());
    symlinkSync('/dev/zero', file());
    expect(fetch(null)).toEqual({ kind: 'unreadable', reason: 'notFile', version: null });
  });

  it('reports a file over the bound without sending it, and sends one at the bound', () => {
    mkdirSync(dir());
    const at = `{"name": "${'x'.repeat(THEME_MAX_BYTES - 12)}"}`;
    expect(Buffer.byteLength(at)).toBe(THEME_MAX_BYTES);
    writeFileSync(file(), at);
    expect(fetch(null)).toMatchObject({ kind: 'present', text: at });

    writeFileSync(file(), 'x'.repeat(THEME_MAX_BYTES * 16));
    const output = run(themeFetchCommand(null));
    expect(output.length).toBeLessThan(100);
    const large = parseThemeFetch(output, null);
    expect(large).toEqual({ kind: 'unreadable', reason: 'tooLarge', version: expect.stringMatching(/^\d+ 65537$/) });
    // Unchanged while it stays too large: one line.
    const version = large!.kind === 'unreadable' ? large!.version : null;
    expect(run(themeFetchCommand(version))).toBe(`${version}\n`);
  });

  // A second reset used to `mv -f` over the first one's backup, and the
  // theme the dialog promised was "renamed, not deleted" was gone.
  it('resets by renaming the file aside, never over an older backup', () => {
    mkdirSync(dir());
    const cat = (path: string) => execFileSync('cat', [path], { encoding: 'utf8' });
    writeFileSync(file(), '{"name": "A"}');
    run(themeResetCommand());
    expect(existsSync(file())).toBe(false);
    expect(cat(`${file()}.bak`)).toBe('{"name": "A"}');
    writeFileSync(file(), '{"name": "B"}');
    run(themeResetCommand());
    writeFileSync(file(), '{"name": "C"}');
    run(themeResetCommand());
    expect([cat(`${file()}.bak`), cat(`${file()}.bak.1`), cat(`${file()}.bak.2`)]).toEqual([
      '{"name": "A"}',
      '{"name": "B"}',
      '{"name": "C"}',
    ]);
    // Nothing there: nothing to do, and no error.
    run(themeResetCommand());
    expect(existsSync(`${file()}.bak.3`)).toBe(false);
    renameSync(`${file()}.bak`, file());
    expect(fetch(null)).toMatchObject({ kind: 'present' });
  });
});
