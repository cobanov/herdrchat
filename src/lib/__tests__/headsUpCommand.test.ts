import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chunkForShell,
  HEADSUP_AT,
  HEADSUP_BEGIN,
  HEADSUP_DETECT_SCRIPT,
  HEADSUP_MAX_BYTES,
  HEADSUP_MISSING,
  HEADSUP_NONE,
  HEADSUP_NOT_FILE,
  HEADSUP_READ_SCRIPT,
  HEADSUP_STALE,
  HEADSUP_SWAP_SCRIPT,
  HEADSUP_TOO_LARGE,
  HEADSUP_UNREADABLE,
  HEADSUP_WRITE_CHUNK_BYTES,
  HEADSUP_WRITTEN,
  headsUpDetectCommand,
  headsUpReadCommand,
  headsUpWriteCommands,
  parseHeadsUpDetect,
  parseHeadsUpRead,
  parseHeadsUpWrite,
  utf8Bytes,
} from '../headsup/command';

const STORE = '/home/me/.claude/plugins/store/headsup_heads-up-claude-mod-5d41402abc4b.json';

describe('the commands as strings', () => {
  // `sh -c` quoting is a plain wrap only while the scripts hold no single quote.
  it('hold no single quote in any script', () => {
    for (const script of [HEADSUP_DETECT_SCRIPT, HEADSUP_READ_SCRIPT, HEADSUP_SWAP_SCRIPT]) expect(script).not.toContain("'");
  });

  it('detect in the plugin store under the Claude config folder', () => {
    const command = headsUpDetectCommand();
    expect(command).toMatch(/^export PATH=.*; sh -c '/);
    expect(command).toContain('"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/store"');
    expect(command).toContain('"$d"/headsup_*.json');
    expect(command).toContain('[ "$f" -nt "$b" ]');
  });

  it('read with the path and the held version as arguments, never in the script', () => {
    const command = headsUpReadCommand(STORE, '123 456');
    expect(command.endsWith(` sh '${STORE}' '123 456'`)).toBe(true);
    expect(command).toContain(`head -c ${HEADSUP_MAX_BYTES + 1} "$f" | cksum`);
    // No version, or one that is not a cksum, is sent as one no host prints.
    expect(headsUpReadCommand(STORE, null).endsWith(` '${STORE}' '-'`)).toBe(true);
    expect(headsUpReadCommand(STORE, "1 2'; rm -rf ~").endsWith(` '${STORE}' '-'`)).toBe(true);
  });

  it('refuse a path detection could not have printed', () => {
    expect(() => headsUpReadCommand('/etc/passwd', null)).toThrow();
    expect(() => headsUpReadCommand('relative/headsup_x.json', null)).toThrow();
    expect(() => headsUpWriteCommands('/tmp/headsup_x.json\n', '1 2', '{}', 'abc')).toThrow();
  });

  it('write in one command that carries the JSON quoted, the version guard and the swap', () => {
    const json = JSON.stringify({ items: [{ text: "It's done" }] });
    const commands = headsUpWriteCommands(STORE, '42 7', json, 'tok1');
    expect(commands).toHaveLength(1);
    const command = commands[0]!;
    expect(command.endsWith(` sh '${STORE}' '${STORE}.herdrchat-tok1.tmp' '42 7' '{"items":[{"text":"It'\\''s done"}]}'`)).toBe(true);
    expect(command).toContain(`if [ "$v" != "$3" ]; then rm -f "$t"; echo ${HEADSUP_STALE}; exit 0; fi`);
    expect(command).toContain('mv -f "$t" "$f"');
    expect(() => headsUpWriteCommands(STORE, 'not a version', json, 'tok1')).toThrow();
    expect(() => headsUpWriteCommands(STORE, '1 2', json, '../x')).toThrow();
  });

  it('send a large file in pieces, each well inside one argument’s cap', () => {
    const json = JSON.stringify({ items: Array.from({ length: 900 }, (_, index) => ({ id: `i${index}`, text: `naïve ✓ 🙂 '${'x'.repeat(120)}` })) });
    const commands = headsUpWriteCommands(STORE, '1 2', json, 'tok2');
    expect(commands.length).toBeGreaterThan(2);
    for (const command of commands) expect(utf8Bytes(command)).toBeLessThan(128 * 1024);
  });
});

describe('chunkForShell', () => {
  it('never splits a character, and counts a quote as its escape', () => {
    const text = `${'🙂'.repeat(10)}${"'".repeat(5)}é`;
    const pieces = chunkForShell(text, 8);
    expect(pieces.join('')).toBe(text);
    for (const piece of pieces) {
      expect(piece).not.toMatch(/[\uD800-\uDBFF]$/);
      expect(utf8Bytes(piece.replaceAll("'", "'\\''"))).toBeLessThanOrEqual(8);
    }
    expect(chunkForShell('')).toEqual(['']);
    expect(chunkForShell('abc')).toEqual(['abc']);
    expect(HEADSUP_WRITE_CHUNK_BYTES).toBeLessThan(128 * 1024);
  });
});

describe('parsing', () => {
  it('reads detection', () => {
    expect(parseHeadsUpDetect(`${HEADSUP_NONE}\n`)).toEqual({ kind: 'none' });
    expect(parseHeadsUpDetect(`${HEADSUP_AT} ${STORE}\n`)).toEqual({ kind: 'found', path: STORE });
    for (const stdout of ['', 'Welcome\n', `${HEADSUP_AT} /etc/passwd\n`, `${HEADSUP_AT} \n`]) expect(parseHeadsUpDetect(stdout)).toBeNull();
  });

  it('reads a read', () => {
    expect(parseHeadsUpRead('5 9\n', '5 9')).toEqual({ kind: 'unchanged' });
    expect(parseHeadsUpRead(`5 9\n${HEADSUP_BEGIN}\n{"items":[]}`, null)).toEqual({ kind: 'present', version: '5 9', text: '{"items":[]}' });
    expect(parseHeadsUpRead(`${HEADSUP_MISSING}\n`, '5 9')).toEqual({ kind: 'missing' });
    expect(parseHeadsUpRead(`${HEADSUP_NOT_FILE}\n`, null)).toEqual({ kind: 'unreadable', version: null });
    expect(parseHeadsUpRead(`${HEADSUP_UNREADABLE}\n`, null)).toEqual({ kind: 'unreadable', version: null });
    expect(parseHeadsUpRead(`5 600000\n${HEADSUP_TOO_LARGE}\n`, null)).toEqual({ kind: 'unreadable', version: '5 600000' });
    // A version alone that is not the one held: the contents went missing.
    for (const stdout of ['', '5 9\n', 'bash: cksum: not found\n', `${HEADSUP_MISSING}\nmore\n`, '5 9\nsomething\n']) {
      expect(parseHeadsUpRead(stdout, '1 1')).toBeNull();
    }
  });

  it('reads a write', () => {
    expect(parseHeadsUpWrite(`${HEADSUP_STALE}\n`)).toEqual({ kind: 'stale' });
    expect(parseHeadsUpWrite(`${HEADSUP_WRITTEN}\n77 12\n`)).toEqual({ kind: 'written', version: '77 12' });
    for (const stdout of ['', `${HEADSUP_WRITTEN}\n`, 'oops\n']) expect(parseHeadsUpWrite(stdout)).toBeNull();
  });
});

describe('the commands on a real shell', () => {
  let home: string;
  const store = () => join(home, '.claude', 'plugins', 'store');
  // Without the session's own config folder, if it has one: the store is looked for under HOME.
  const env = () => ({ ...process.env, HOME: home, CLAUDE_CONFIG_DIR: '' });
  const run = (command: string) => execFileSync('sh', ['-c', command], { env: env(), encoding: 'utf8' });
  const detect = () => parseHeadsUpDetect(run(headsUpDetectCommand()));
  const read = (path: string, last: string | null) => parseHeadsUpRead(run(headsUpReadCommand(path, last)), last);
  const write = (path: string, version: string, json: string, token = 'tok') => {
    let stdout = '';
    for (const command of headsUpWriteCommands(path, version, json, token)) stdout = run(command);
    return parseHeadsUpWrite(stdout);
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'herdrchat-headsup-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('finds nothing without the store, and the newest store when there are several', () => {
    expect(detect()).toEqual({ kind: 'none' });
    mkdirSync(store(), { recursive: true });
    writeFileSync(join(store(), 'other_market-aaaaaaaaaaaa.json'), '{}');
    expect(detect()).toEqual({ kind: 'none' });
    const older = join(store(), 'headsup_one-aaaaaaaaaaaa.json');
    const newer = join(store(), 'headsup_two-bbbbbbbbbbbb.json');
    writeFileSync(older, '{}');
    writeFileSync(newer, '{}');
    utimesSync(older, new Date(2026, 0, 1), new Date(2026, 0, 1));
    expect(detect()).toEqual({ kind: 'found', path: newer });
    utimesSync(older, new Date(2026, 5, 1), new Date(2026, 5, 1));
    utimesSync(newer, new Date(2026, 0, 1), new Date(2026, 0, 1));
    expect(detect()).toEqual({ kind: 'found', path: older });
  });

  it('passes over a store that is not a regular file', () => {
    mkdirSync(join(store(), 'headsup_dir-aaaaaaaaaaaa.json'), { recursive: true });
    execFileSync('mkfifo', [join(store(), 'headsup_fifo-bbbbbbbbbbbb.json')]);
    expect(detect()).toEqual({ kind: 'none' });
  });

  it('reads, reads unchanged, writes against the version, and refuses a stale one', () => {
    mkdirSync(store(), { recursive: true });
    const path = join(store(), 'headsup_m-cccccccccccc.json');
    writeFileSync(path, '{"items":[{"id":"a"}],"other":1}');
    const first = read(path, null);
    expect(first).toMatchObject({ kind: 'present', text: '{"items":[{"id":"a"}],"other":1}' });
    const version = (first as { version: string }).version;
    expect(read(path, version)).toEqual({ kind: 'unchanged' });

    const next = JSON.stringify({ items: [{ id: 'a', text: "It's ✓ done 🙂" }], other: 1 });
    const written = write(path, version, next);
    expect(written?.kind).toBe('written');
    expect(readFileSync(path, 'utf8')).toBe(next);
    expect(read(path, (written as { version: string }).version)).toEqual({ kind: 'unchanged' });

    // The version the change was made against is gone: nothing changes, and no temp file is left.
    expect(write(path, version, '{"items":[]}')).toEqual({ kind: 'stale' });
    expect(readFileSync(path, 'utf8')).toBe(next);
    expect(readdirSync(store())).toEqual(['headsup_m-cccccccccccc.json']);
  });

  it('writes a file too big for one command in pieces', () => {
    mkdirSync(store(), { recursive: true });
    const path = join(store(), 'headsup_m-dddddddddddd.json');
    writeFileSync(path, '{}');
    const version = (read(path, null) as { version: string }).version;
    const big = JSON.stringify({ items: Array.from({ length: 700 }, (_, index) => ({ id: `i${index}`, text: `naïve ✓ 🙂 '${'x'.repeat(200)}` })) });
    expect(headsUpWriteCommands(path, version, big, 'big').length).toBeGreaterThan(2);
    expect(write(path, version, big, 'big')?.kind).toBe('written');
    expect(readFileSync(path, 'utf8')).toBe(big);
    expect(existsSync(`${path}.herdrchat-big.tmp`)).toBe(false);
  });

  it('reports a store that is gone, or past the cap, without sending it', () => {
    mkdirSync(store(), { recursive: true });
    const path = join(store(), 'headsup_m-eeeeeeeeeeee.json');
    expect(read(path, null)).toEqual({ kind: 'missing' });
    writeFileSync(path, `{"pad":"${'x'.repeat(HEADSUP_MAX_BYTES)}"}`);
    expect(read(path, null)).toMatchObject({ kind: 'unreadable' });
  });
});
