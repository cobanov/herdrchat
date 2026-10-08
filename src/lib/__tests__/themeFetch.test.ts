import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterFetch,
  deserializeThemeFile,
  knownMtime,
  parseThemeFetch,
  serializeThemeFile,
  THEME_BEGIN,
  THEME_MISSING,
  THEME_UNREADABLE,
  themeFetchCommand,
  themeResetCommand,
} from '../theme/hostTheme';
import type { HostThemeFile } from '../theme/resolve';

describe('parseThemeFetch', () => {
  it('reads an unchanged file as unchanged', () => {
    expect(parseThemeFetch('1700000000\n', 1700000000)).toEqual({ kind: 'unchanged' });
  });

  it('reads a changed file with its contents, byte for byte', () => {
    const text = '{\n  "accent": "#123456"\n}\n';
    expect(parseThemeFetch(`1700000001\n${THEME_BEGIN}\n${text}`, 1700000000)).toEqual({ kind: 'present', mtime: 1700000001, text });
    expect(parseThemeFetch(`5\n${THEME_BEGIN}\n`, null)).toEqual({ kind: 'present', mtime: 5, text: '' });
  });

  it('reads a missing file as missing, whatever was held before', () => {
    expect(parseThemeFetch(`${THEME_MISSING}\n`, null)).toEqual({ kind: 'missing' });
    // Removed after having existed: the theme goes back to the app's own.
    const held: HostThemeFile = { kind: 'present', mtime: 9, text: '{}' };
    const result = parseThemeFetch(`${THEME_MISSING}\n`, knownMtime(held));
    expect(afterFetch(held, result!)).toEqual({ kind: 'missing' });
  });

  it('reads an unreadable file as one', () => {
    expect(parseThemeFetch(`7\n${THEME_UNREADABLE}\n`, null)).toEqual({ kind: 'unreadable', mtime: 7 });
  });

  // Anything the command does not print is a failed check, not "no theme":
  // a failed check keeps the theme it has.
  it.each([
    '',
    'bash: stat: command not found\n',
    'Welcome to Ubuntu\n1700000000\n',
    '1700000000\n', // just an mtime, but not the one held: the contents went missing
    `1700000000\nsomething else\n`,
    `${THEME_MISSING}\nmore\n`,
  ])('reads %j as a failed check', (stdout) => {
    expect(parseThemeFetch(stdout, 1)).toBeNull();
  });

  it('keeps the held file on unchanged', () => {
    const held: HostThemeFile = { kind: 'present', mtime: 9, text: '{}' };
    expect(afterFetch(held, { kind: 'unchanged' })).toBe(held);
  });

  it('sends only a held file’s mtime', () => {
    expect(knownMtime({ kind: 'present', mtime: 9, text: '' })).toBe(9);
    expect(knownMtime({ kind: 'unreadable', mtime: 9 })).toBeNull();
    expect(knownMtime({ kind: 'missing' })).toBeNull();
  });
});

describe('the stored file', () => {
  it.each<HostThemeFile>([
    { kind: 'missing' },
    { kind: 'unreadable', mtime: 3 },
    { kind: 'present', mtime: 4, text: '{"name": "x"}\n' },
  ])('round-trips %j', (file) => {
    expect(deserializeThemeFile(serializeThemeFile(file))).toEqual(file);
  });

  it.each([null, undefined, '', 'nope', '{"kind":"present","mtime":"4","text":""}', '{"kind":"other"}', '7'])('refuses %j', (text) => {
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
  const fetch = (last: number | null) => parseThemeFetch(run(themeFetchCommand(last)), last);

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
    const mtime = first!.kind === 'present' ? first!.mtime : -1;
    expect(mtime).toBeGreaterThan(1_000_000_000);

    expect(fetch(mtime)).toEqual({ kind: 'unchanged' });
    expect(run(themeFetchCommand(mtime))).toBe(`${mtime}\n`);

    expect(fetch(mtime - 10)).toEqual({ kind: 'present', mtime, text });

    rmSync(file());
    expect(fetch(mtime)).toEqual({ kind: 'missing' });
  });

  it('says when it cannot read the file', () => {
    if (process.getuid?.() === 0) return; // root reads anything
    mkdirSync(dir());
    writeFileSync(file(), '{}');
    chmodSync(file(), 0o000);
    expect(fetch(null)).toMatchObject({ kind: 'unreadable' });
    chmodSync(file(), 0o600);
  });

  it('resets by renaming the file aside, over an older backup', () => {
    mkdirSync(dir());
    writeFileSync(`${file()}.bak`, 'old');
    writeFileSync(file(), '{"name": "new"}');
    run(themeResetCommand());
    expect(existsSync(file())).toBe(false);
    expect(execFileSync('cat', [`${file()}.bak`], { encoding: 'utf8' })).toBe('{"name": "new"}');
    // Nothing there: nothing to do, and no error.
    run(themeResetCommand());
    renameSync(`${file()}.bak`, file());
    expect(fetch(null)).toMatchObject({ kind: 'present' });
  });
});
