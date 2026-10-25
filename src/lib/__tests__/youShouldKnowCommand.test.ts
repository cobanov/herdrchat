import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chunkForShell,
  YSK_AT,
  YSK_BEGIN,
  YSK_DETECT_SCRIPT,
  YSK_MAX_BYTES,
  YSK_MISSING,
  YSK_NONE,
  YSK_NOT_FILE,
  YSK_READ_SCRIPT,
  YSK_STALE,
  YSK_SWAP_SCRIPT,
  YSK_TOO_LARGE,
  YSK_UNREADABLE,
  YSK_WRITE_CHUNK_BYTES,
  YSK_WRITTEN,
  yskCleanupCommand,
  yskDetectCommand,
  yskReadCommand,
  yskWriteCommands,
  parseYskDetect,
  parseYskRead,
  parseYskWrite,
  utf8Bytes,
} from '../youShouldKnow/command';

const STORE = '/home/me/.claude/plugins/store/cc-plugin-you-should-know_builtin-19776595df2c.json';

describe('the commands as strings', () => {
  // `sh -c` quoting is a plain wrap only while the scripts hold no single quote.
  it('hold no single quote in any script', () => {
    for (const script of [YSK_DETECT_SCRIPT, YSK_READ_SCRIPT, YSK_SWAP_SCRIPT]) expect(script).not.toContain("'");
  });

  it('detect in the plugin store under the Claude config folder', () => {
    const command = yskDetectCommand();
    expect(command).toMatch(/^export PATH=.*; sh -c '/);
    expect(command).toContain('"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/store"');
    expect(command).toContain('"$d"/cc-plugin-you-should-know_*.json');
    expect(command).toContain('[ "$f" -nt "$b" ]');
  });

  it('read with the path and the held version as arguments, never in the script', () => {
    const command = yskReadCommand(STORE, '123 456');
    expect(command.endsWith(` sh '${STORE}' '123 456'`)).toBe(true);
    expect(command).toContain(`head -c ${YSK_MAX_BYTES + 1} "$f" > "$c"`);
    // No version, or one that is not a cksum, is sent as one no host prints.
    expect(yskReadCommand(STORE, null).endsWith(` '${STORE}' '-'`)).toBe(true);
    expect(yskReadCommand(STORE, "1 2'; rm -rf ~").endsWith(` '${STORE}' '-'`)).toBe(true);
  });

  it('refuse a path detection could not have printed', () => {
    expect(() => yskReadCommand('/etc/passwd', null)).toThrow();
    expect(() => yskReadCommand('relative/cc-plugin-you-should-know_x.json', null)).toThrow();
    expect(() => yskWriteCommands('/tmp/cc-plugin-you-should-know_x.json\n', '1 2', '{}', 'abc')).toThrow();
  });

  it('write in one command that carries the JSON quoted, the version guard and the swap', () => {
    const json = JSON.stringify({ sessions: [{ text: "It's done" }] });
    const commands = yskWriteCommands(STORE, '42 7', json, 'tok1');
    expect(commands).toHaveLength(1);
    const command = commands[0]!;
    expect(command.endsWith(` sh '${STORE}' '${STORE}.herdrchat-tok1.tmp' '42 7' '{"sessions":[{"text":"It'\\''s done"}]}'`)).toBe(true);
    expect(command).toContain(`if [ "$v" != "$3" ]; then rm -f "$t"; echo ${YSK_STALE}; exit 0; fi`);
    expect(command).toContain('mv -f "$t" "$f"');
    expect(() => yskWriteCommands(STORE, 'not a version', json, 'tok1')).toThrow();
    expect(() => yskWriteCommands(STORE, '1 2', json, '../x')).toThrow();
  });

  it('send a large file in pieces, each well inside one argument’s cap', () => {
    const json = JSON.stringify({ sessions: Array.from({ length: 900 }, (_, index) => ({ id: `i${index}`, text: `naïve ✓ 🙂 '${'x'.repeat(120)}` })) });
    const commands = yskWriteCommands(STORE, '1 2', json, 'tok2');
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
    expect(YSK_WRITE_CHUNK_BYTES).toBeLessThan(128 * 1024);
  });
});

describe('parsing', () => {
  it('reads detection', () => {
    expect(parseYskDetect(`${YSK_NONE}\n`)).toEqual({ kind: 'none' });
    expect(parseYskDetect(`${YSK_AT} ${STORE}\n`)).toEqual({ kind: 'found', path: STORE });
    for (const stdout of ['', 'Welcome\n', `${YSK_AT} /etc/passwd\n`, `${YSK_AT} \n`]) expect(parseYskDetect(stdout)).toBeNull();
  });

  it('reads a read', () => {
    expect(parseYskRead('5 9\n', '5 9')).toEqual({ kind: 'unchanged' });
    expect(parseYskRead(`5 9\n${YSK_BEGIN}\n{"sessions":[]}`, null)).toEqual({ kind: 'present', version: '5 9', text: '{"sessions":[]}' });
    expect(parseYskRead(`${YSK_MISSING}\n`, '5 9')).toEqual({ kind: 'missing' });
    expect(parseYskRead(`${YSK_NOT_FILE}\n`, null)).toEqual({ kind: 'unreadable', version: null });
    expect(parseYskRead(`${YSK_UNREADABLE}\n`, null)).toEqual({ kind: 'unreadable', version: null });
    expect(parseYskRead(`5 600000\n${YSK_TOO_LARGE}\n`, null)).toEqual({ kind: 'unreadable', version: '5 600000' });
    // A version alone that is not the one held: the contents went missing.
    for (const stdout of ['', '5 9\n', 'bash: cksum: not found\n', `${YSK_MISSING}\nmore\n`, '5 9\nsomething\n']) {
      expect(parseYskRead(stdout, '1 1')).toBeNull();
    }
  });

  it('reads a write', () => {
    expect(parseYskWrite(`${YSK_STALE}\n`)).toEqual({ kind: 'stale' });
    expect(parseYskWrite(`${YSK_WRITTEN}\n77 12\n`)).toEqual({ kind: 'written', version: '77 12' });
    for (const stdout of ['', `${YSK_WRITTEN}\n`, 'oops\n']) expect(parseYskWrite(stdout)).toBeNull();
  });
});

describe('the commands on a real shell', () => {
  let home: string;
  const store = () => join(home, '.claude', 'plugins', 'store');
  // Without the session's own config folder, if it has one: the store is looked for under HOME.
  const env = () => ({ ...process.env, HOME: home, CLAUDE_CONFIG_DIR: '' });
  const run = (command: string) => execFileSync('sh', ['-c', command], { env: env(), encoding: 'utf8' });
  const detect = () => parseYskDetect(run(yskDetectCommand()));
  const read = (path: string, last: string | null) => parseYskRead(run(yskReadCommand(path, last)), last);
  const write = (path: string, version: string, json: string, token = 'tok') => {
    let stdout = '';
    for (const command of yskWriteCommands(path, version, json, token)) stdout = run(command);
    return parseYskWrite(stdout);
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'herdrchat-ysk-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('finds nothing without the store, and the newest store when there are several', () => {
    expect(detect()).toEqual({ kind: 'none' });
    mkdirSync(store(), { recursive: true });
    writeFileSync(join(store(), 'other_market-aaaaaaaaaaaa.json'), '{}');
    expect(detect()).toEqual({ kind: 'none' });
    const older = join(store(), 'cc-plugin-you-should-know_one-aaaaaaaaaaaa.json');
    const newer = join(store(), 'cc-plugin-you-should-know_two-bbbbbbbbbbbb.json');
    writeFileSync(older, '{}');
    writeFileSync(newer, '{}');
    utimesSync(older, new Date(2026, 0, 1), new Date(2026, 0, 1));
    expect(detect()).toEqual({ kind: 'found', path: newer });
    utimesSync(older, new Date(2026, 5, 1), new Date(2026, 5, 1));
    utimesSync(newer, new Date(2026, 0, 1), new Date(2026, 0, 1));
    expect(detect()).toEqual({ kind: 'found', path: older });
  });

  it('passes over a store that is not a regular file', () => {
    mkdirSync(join(store(), 'cc-plugin-you-should-know_dir-aaaaaaaaaaaa.json'), { recursive: true });
    execFileSync('mkfifo', [join(store(), 'cc-plugin-you-should-know_fifo-bbbbbbbbbbbb.json')]);
    expect(detect()).toEqual({ kind: 'none' });
  });

  it('reads, reads unchanged, writes against the version, and refuses a stale one', () => {
    mkdirSync(store(), { recursive: true });
    const path = join(store(), 'cc-plugin-you-should-know_m-cccccccccccc.json');
    writeFileSync(path, '{"sessions":[{"id":"a"}],"other":1}');
    const first = read(path, null);
    expect(first).toMatchObject({ kind: 'present', text: '{"sessions":[{"id":"a"}],"other":1}' });
    const version = (first as { version: string }).version;
    expect(read(path, version)).toEqual({ kind: 'unchanged' });

    const next = JSON.stringify({ sessions: [{ id: 'a', text: "It's ✓ done 🙂" }], other: 1 });
    const written = write(path, version, next);
    expect(written?.kind).toBe('written');
    expect(readFileSync(path, 'utf8')).toBe(next);
    expect(read(path, (written as { version: string }).version)).toEqual({ kind: 'unchanged' });

    // The version the change was made against is gone: nothing changes, and no temp file is left.
    expect(write(path, version, '{"sessions":[]}')).toEqual({ kind: 'stale' });
    expect(readFileSync(path, 'utf8')).toBe(next);
    expect(readdirSync(store())).toEqual(['cc-plugin-you-should-know_m-cccccccccccc.json']);
  });

  it('writes a file too big for one command in pieces', () => {
    mkdirSync(store(), { recursive: true });
    const path = join(store(), 'cc-plugin-you-should-know_m-dddddddddddd.json');
    writeFileSync(path, '{}');
    const version = (read(path, null) as { version: string }).version;
    const big = JSON.stringify({ sessions: Array.from({ length: 700 }, (_, index) => ({ id: `i${index}`, text: `naïve ✓ 🙂 '${'x'.repeat(200)}` })) });
    expect(yskWriteCommands(path, version, big, 'big').length).toBeGreaterThan(2);
    expect(write(path, version, big, 'big')?.kind).toBe('written');
    expect(readFileSync(path, 'utf8')).toBe(big);
    expect(existsSync(`${path}.herdrchat-big.tmp`)).toBe(false);
  });

  /** A command on the host's PATH ahead of the real one (`withPath` puts ~/.local/bin first). */
  const shim = (name: string, body: string) => {
    const bin = join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  };
  const cksumOf = (text: string) => execFileSync('cksum', { input: text, encoding: 'utf8' }).trim();

  it('prints the version of what it moved into place, even when a session writes right after the move', () => {
    mkdirSync(store(), { recursive: true });
    const path = join(store(), 'cc-plugin-you-should-know_m-ffffffffffff.json');
    writeFileSync(path, '{}');
    const version = (read(path, null) as { version: string }).version;
    // The real mv, then another writer straight after it.
    shim('mv', `/bin/mv "$@" && printf %s '{"sessions":[{"id":"t"}]}' > "${path}"`);
    const mine = '{"sessions":[{"id":"mine"}]}';
    const written = write(path, version, mine);
    expect(written).toEqual({ kind: 'written', version: cksumOf(mine) });
    // So the next read sees the other writer's file as changed, and sends it.
    expect(read(path, (written as { version: string }).version)).toMatchObject({ kind: 'present', text: '{"sessions":[{"id":"t"}]}' });
  });

  it('takes the moved bytes’ version before checking the store, so a write while it runs is caught', () => {
    mkdirSync(store(), { recursive: true });
    const path = join(store(), 'cc-plugin-you-should-know_m-121212121212.json');
    writeFileSync(path, '{}');
    const version = (read(path, null) as { version: string }).version;
    // A session writes the store while the script's first cksum runs. With the
    // temp file's cksum between the check and the mv, this write was lost.
    const fired = join(home, 'fired');
    shim('cksum', `/usr/bin/env -i PATH=/usr/bin:/bin cksum "$@"; [ -e "${fired}" ] || { : > "${fired}"; printf %s '{"sessions":[{"id":"t"}]}' > "${path}"; }`);
    expect(write(path, version, '{"sessions":[{"id":"mine"}]}')).toEqual({ kind: 'stale' });
    expect(readFileSync(path, 'utf8')).toBe('{"sessions":[{"id":"t"}]}');
    expect(readdirSync(store())).toEqual(['cc-plugin-you-should-know_m-121212121212.json']);
  });

  it('keeps the store’s cksum, the check and the mv back to back', () => {
    const lines = YSK_SWAP_SCRIPT.split('\n');
    const at = (start: string) => lines.findIndex((line) => line.startsWith(start));
    expect(at('n=')).toBeGreaterThan(-1);
    expect(at('n=')).toBeLessThan(at('v='));
    expect(at('if [ "$v"')).toBe(at('v=') + 1);
    expect(at('mv ')).toBe(at('v=') + 2);
  });

  // A known limit, not a guarantee: without a lock the terminal honours, a
  // write landing between the store's cksum and the mv is replaced unseen.
  it('still loses a write that lands between the check and the mv (no lock exists)', () => {
    mkdirSync(store(), { recursive: true });
    const path = join(store(), 'cc-plugin-you-should-know_m-343434343434.json');
    writeFileSync(path, '{}');
    const version = (read(path, null) as { version: string }).version;
    shim('mv', `printf %s '{"sessions":[{"id":"t"}]}' > "${path}"; /bin/mv "$@"`);
    const mine = '{"sessions":[{"id":"mine"}]}';
    expect(write(path, version, mine)).toEqual({ kind: 'written', version: cksumOf(mine) });
    expect(readFileSync(path, 'utf8')).toBe(mine);
  });

  it('reads the file once: the version and the contents always match, and no copy is left', () => {
    mkdirSync(store(), { recursive: true });
    const path = join(store(), 'cc-plugin-you-should-know_m-111111111111.json');
    writeFileSync(path, '{"sessions":[]}');
    const tmp = join(home, 'tmp');
    mkdirSync(tmp);
    // A session writes the store between the version and the contents.
    shim('cksum', `/usr/bin/env -i PATH=/usr/bin:/bin cksum "$@"; printf %s '{"sessions":[{"id":"later"}]}' > "${path}"`);
    const stdout = execFileSync('sh', ['-c', yskReadCommand(path, null)], { env: { ...env(), TMPDIR: tmp }, encoding: 'utf8' });
    const result = parseYskRead(stdout, null);
    expect(result).toEqual({ kind: 'present', version: cksumOf('{"sessions":[]}'), text: '{"sessions":[]}' });
    expect(readdirSync(tmp)).toEqual([]);
  });

  it('removes a write’s temp file when its pieces did not all go', () => {
    mkdirSync(store(), { recursive: true });
    const path = join(store(), 'cc-plugin-you-should-know_m-222222222222.json');
    writeFileSync(path, '{}');
    writeFileSync(`${path}.herdrchat-tok.tmp`, '{"part');
    run(yskCleanupCommand(path, 'tok'));
    expect(readdirSync(store())).toEqual(['cc-plugin-you-should-know_m-222222222222.json']);
    expect(() => yskCleanupCommand(path, 'a b')).toThrow();
  });

  it('reports a store that is gone, or past the cap, without sending it', () => {
    mkdirSync(store(), { recursive: true });
    const path = join(store(), 'cc-plugin-you-should-know_m-eeeeeeeeeeee.json');
    expect(read(path, null)).toEqual({ kind: 'missing' });
    writeFileSync(path, `{"pad":"${'x'.repeat(YSK_MAX_BYTES)}"}`);
    expect(read(path, null)).toMatchObject({ kind: 'unreadable' });
  });
});
