/**
 * "You should know"'s store on the host: finding it, reading it, and writing
 * it back.
 *
 * Built like the host theme's fetch (`src/lib/theme/hostTheme.ts`): one
 * bounded `sh` command each, a `cksum` version so an unchanged file costs a
 * line, and a sentinel for each thing that is not a file to read, so "there is
 * no "You should know" here" and "the check failed" never look alike.
 *
 * The scripts hold no single quote, so quoting each for `sh -c` is a plain
 * wrap, and everything that varies (the path, the version, the new contents
 * as base64) goes in as a positional argument through `shellQuote`, never
 * into the script.
 */
import { decodeBase64, UPLOAD_CHUNK_CHARS } from '../attachments/upload';
import { noBackslashes, shellQuote, withPath } from '../herdr/shell';
import { base64 } from '../herdr/socket';

/**
 * Claude Code's built-in "You should know" plugin keeps its store in
 * `cc-plugin-you-should-know_<marketplace>-<12 hex>.json` (the marketplace is
 * `builtin`).
 */
export const YSK_STORE_GLOB = 'cc-plugin-you-should-know_*.json';

/** Claude Code's plugin store, under its config folder. */
const STORE_DIR = '"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/store"';

/**
 * The largest store the app reads or writes. The plugin keeps at most 32
 * session rows and 50 lines each of `seen` and `known`, a few kilobytes; a
 * file past this is not one to buffer whole on a phone.
 */
export const YSK_MAX_BYTES = 512 * 1024;

export const YSK_NONE = 'HERDRCHAT_YSK_NONE';
export const YSK_AT = 'HERDRCHAT_YSK_AT';
export const YSK_MISSING = 'HERDRCHAT_YSK_MISSING';
export const YSK_NOT_FILE = 'HERDRCHAT_YSK_NOT_FILE';
export const YSK_UNREADABLE = 'HERDRCHAT_YSK_UNREADABLE';
export const YSK_TOO_LARGE = 'HERDRCHAT_YSK_TOO_LARGE';
/** The line after which the rest of the output is the file, byte for byte. */
export const YSK_BEGIN = 'HERDRCHAT_YSK_BEGIN';
/** A write found the file changed since it was read, and changed nothing. */
export const YSK_STALE = 'HERDRCHAT_YSK_STALE';
/** A write landed; the next line is the file's new version. */
export const YSK_WRITTEN = 'HERDRCHAT_YSK_WRITTEN';

/** Stands for "no version known", which no `cksum` prints. */
const NO_VERSION = '-';
/** What `cksum` prints: a CRC and a byte count. */
const VERSION = /^\d+ \d+$/;
/** A store path as detection prints it: absolute, one line, the plugin's file name. */
const STORE_PATH = /^\/[^\n]*\/cc-plugin-you-should-know_[^/\n]*\.json$/;
/** A temp file's token: letters and digits only. */
const TOKEN = /^[A-Za-z0-9]{1,32}$/;

/** `noBackslashes`: what `shellQuote` puts in for a quote in an argument reaches `sh` intact through fish too. */
const sh = (script: string, args: readonly string[]) =>
  noBackslashes(withPath(`sh -c ${shellQuote(script)} sh${args.map((arg) => ` ${shellQuote(arg)}`).join('')}`));

// MARK: - Detect

/**
 * Whether the host has a "You should know" store: the newest regular,
 * readable `cc-plugin-you-should-know_*.json` in the plugin store (the
 * marketplace part of the name and the hash vary, so there may be
 * more than one), or a sentinel. `[ -f ]` refuses a FIFO or a device before
 * anything could read it.
 */
export const YSK_DETECT_SCRIPT = [
  `d=${STORE_DIR}`,
  'b=',
  `for f in "$d"/${YSK_STORE_GLOB}; do`,
  '  if [ -f "$f" ] && [ -r "$f" ]; then',
  '    if [ -z "$b" ] || [ "$f" -nt "$b" ]; then b=$f; fi',
  '  fi',
  'done',
  `if [ -z "$b" ]; then echo ${YSK_NONE}; else echo "${YSK_AT} $b"; fi`,
].join('\n');

export function yskDetectCommand(): string {
  return sh(YSK_DETECT_SCRIPT, []);
}

/** What detection found. Null: not something the command prints, a failed check. */
export type YskDetect = { kind: 'none' } | { kind: 'found'; path: string };

export function parseYskDetect(stdout: string): YskDetect | null {
  const line = stdout.trim();
  if (line === YSK_NONE) return { kind: 'none' };
  if (!line.startsWith(`${YSK_AT} `)) return null;
  const path = line.slice(YSK_AT.length + 1);
  return STORE_PATH.test(path) ? { kind: 'found', path } : null;
}

/** A path detection could have printed, safe to hand back to the host. */
export function isStorePath(path: string): boolean {
  return STORE_PATH.test(path);
}

// MARK: - Read

/**
 * The read: the file's version, and its contents only when that differs from
 * `$2` (the version held, or `-`). Bounded like the theme's: `head -c` never
 * reads more than one byte past the cap, and a file past it is reported, not
 * sent.
 *
 * The file is read once, into a private copy that the version and the
 * contents both come from, so a session writing it between the two can never
 * pair one version with another version's contents.
 */
export const YSK_READ_SCRIPT = [
  'f=$1',
  `if [ ! -e "$f" ]; then echo ${YSK_MISSING}; exit 0; fi`,
  `if [ ! -f "$f" ]; then echo ${YSK_NOT_FILE}; exit 0; fi`,
  `if [ ! -r "$f" ]; then echo ${YSK_UNREADABLE}; exit 0; fi`,
  'c=$(mktemp) || exit 1',
  'trap "rm -f \\"$c\\"" EXIT',
  `head -c ${YSK_MAX_BYTES + 1} "$f" > "$c" || exit 1`,
  'v=$(cksum < "$c")',
  'echo "$v"',
  'if [ "$v" = "$2" ]; then exit 0; fi',
  `if [ "\${v##* }" -gt ${YSK_MAX_BYTES} ]; then echo ${YSK_TOO_LARGE}; exit 0; fi`,
  `echo ${YSK_BEGIN}`,
  'cat "$c"',
].join('\n');

export function yskReadCommand(path: string, lastVersion: string | null): string {
  if (!isStorePath(path)) throw new Error(`Not a "You should know" store: ${path}`);
  return sh(YSK_READ_SCRIPT, [path, lastVersion !== null && VERSION.test(lastVersion) ? lastVersion : NO_VERSION]);
}

export type YskRead =
  | { kind: 'unchanged' }
  | { kind: 'present'; version: string; text: string }
  /** Gone since detection: the host has no notes until it is found again. */
  | { kind: 'missing' }
  /** There, but not to be read: not a file, not readable, or past the cap. */
  | { kind: 'unreadable'; version: string | null };

/** The read's stdout. Null: not something the command prints, a failed read. */
export function parseYskRead(stdout: string, lastVersion: string | null): YskRead | null {
  const firstBreak = stdout.indexOf('\n');
  const first = (firstBreak === -1 ? stdout : stdout.slice(0, firstBreak)).trim();
  const rest = firstBreak === -1 ? '' : stdout.slice(firstBreak + 1);
  const alone = (result: YskRead) => (rest.trim().length === 0 ? result : null);

  if (first === YSK_MISSING) return alone({ kind: 'missing' });
  if (first === YSK_NOT_FILE || first === YSK_UNREADABLE) return alone({ kind: 'unreadable', version: null });
  if (!VERSION.test(first)) return null;
  if (rest.trim().length === 0) return first === lastVersion ? { kind: 'unchanged' } : null;
  if (rest.trim() === YSK_TOO_LARGE) return { kind: 'unreadable', version: first };
  if (!rest.startsWith(`${YSK_BEGIN}\n`) && rest !== YSK_BEGIN) return null;
  return { kind: 'present', version: first, text: rest.slice(YSK_BEGIN.length + 1) };
}

// MARK: - Write

/**
 * How the new contents travel: as base64, decoded on the host, never as the
 * JSON itself. sshd hands every command to the user's login shell first, and
 * fish keeps `\\` special inside single quotes, so a store with an escaped
 * backslash in it (`"C:\\tmp"`, a regex in a note) would lose one on the way
 * and the swap would move the altered file over the store. The picture and
 * file uploads write the same way (`decodeBase64`); no write command holds a
 * backslash (`noBackslashes` takes the one `shellQuote` would put in for a
 * quote in the path).
 *
 * The base64 goes into a part file beside the store's path, in pieces of
 * `UPLOAD_CHUNK_CHARS` when it does not fit one command (a host shell takes
 * the whole command as one argument, which Linux caps at 128 KB), and the
 * swap decodes it into a temp file beside the store's TARGET: a store that is
 * a symlink (dotfiles) keeps its link, and its file gets the new bytes.
 */

/** Starts the part file with the first piece of base64 (`$1` the part file, `$2` the piece). */
export const YSK_PART_FIRST_SCRIPT = 'umask 077\nprintf %s "$2" > "$1"';
/** Adds a later piece. */
export const YSK_PART_NEXT_SCRIPT = 'printf %s "$2" >> "$1"';

/** How many links the swap follows to the store's file before it gives up (a loop). */
const MAX_LINKS = 40;

/**
 * The compare-and-swap: `$1` the store, `$2` the write's token, `$3` the
 * version the change was made against, `$4` (when the whole file fits in one
 * command) the base64 to put in the part file first. Follows `$1` through any
 * symlinks to the file itself (a relative link resolves against its own
 * folder; `readlink` without `-f`, which older macOS lacks), decodes the part
 * file into a temp file beside that file, and moves it into place only while
 * the store still has that version, printing the new one; otherwise removes
 * it, prints the stale sentinel and changes nothing. A `mv` within one folder
 * replaces the file in one step, so no session ever reads half of it. The
 * version printed is that of the bytes moved. Every way out removes the part
 * file and the temp file.
 *
 * Not a lock: a known limit. The plugin offers none the terminal honours, so
 * a terminal write landing between the store's `cksum` and the `mv` is still
 * replaced by this one, and the app is none the wiser. Everything that can
 * happen earlier (the part file, the decode, the temp file's version) does,
 * so the store's `cksum`, the comparison and the `mv` follow each other
 * directly and that gap is as short as the shell can make it.
 */
export const YSK_SWAP_SCRIPT = [
  'f=$1; p=$1.herdrchat-$2.b64',
  'umask 077',
  'if [ $# -ge 4 ]; then printf %s "$4" > "$p" || { rm -f "$p"; exit 1; }; fi',
  'i=0',
  'while [ -L "$f" ]; do',
  '  l=$(readlink "$f") || { rm -f "$p"; exit 1; }',
  '  case $l in /*) f=$l ;; *) f=${f%/*}/$l ;; esac',
  `  i=$((i + 1)); if [ "$i" -gt ${MAX_LINKS} ]; then rm -f "$p"; exit 1; fi`,
  'done',
  't=$f.herdrchat-$2.tmp',
  `${decodeBase64('"$p"')} > "$t" || { rm -f "$p" "$t"; exit 1; }`,
  'rm -f "$p"',
  // The version of the bytes to be moved into place, taken before the move
  // (one taken after could be another writer's, which the app would then hold
  // beside its own contents and later write over) and before the check, so
  // it does not widen the gap below.
  `n=$(head -c ${YSK_MAX_BYTES + 1} "$t" | cksum)`,
  `if [ ! -f "$f" ]; then rm -f "$t"; echo ${YSK_STALE}; exit 0; fi`,
  // The gap: from here to the `mv`, a terminal write is lost (see above).
  `v=$(head -c ${YSK_MAX_BYTES + 1} "$f" | cksum)`,
  `if [ "$v" != "$3" ]; then rm -f "$t"; echo ${YSK_STALE}; exit 0; fi`,
  'mv -f "$t" "$f" || { rm -f "$t"; exit 1; }',
  `echo ${YSK_WRITTEN}`,
  'echo "$n"',
].join('\n');

/** Removes a write's part file (`$1`) after a piece, or the swap, failed to go. */
export const YSK_CLEANUP_SCRIPT = 'rm -f "$1"';

/** UTF-8 bytes of one code point. */
function codePointBytes(codePoint: number): number {
  return codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
}

/** UTF-8 bytes of a string. */
export function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const char of value) bytes += codePointBytes(char.codePointAt(0) ?? 0);
  return bytes;
}

/** The part file a write's base64 goes into, beside the store's path, which the plugin's glob does not match. */
export function partPath(path: string, token: string): string {
  return `${path}.herdrchat-${token}.b64`;
}

/** The temp file the swap decodes into, beside the store's file (its path, when it is no symlink). */
export function tempPath(path: string, token: string): string {
  return `${path}.herdrchat-${token}.tmp`;
}

/** A path a write may name: one detection could print, with no backslash for a login shell to rewrite. */
function writablePath(path: string): void {
  if (!isStorePath(path) || path.includes('\\')) throw new Error(`Not a "You should know" store: ${path}`);
}

/**
 * The commands that write `json` over the store at `path`, in order, if and
 * only if it still has `version`: the base64 pieces into the part file, then
 * the swap. One command when it fits in one, which is nearly always.
 */
export function yskWriteCommands(path: string, version: string, json: string, token: string): string[] {
  writablePath(path);
  if (!VERSION.test(version)) throw new Error(`Not a version: ${version}`);
  if (!TOKEN.test(token)) throw new Error(`Not a token: ${token}`);
  const encoded = base64(json);
  if (encoded.length <= UPLOAD_CHUNK_CHARS) return [sh(YSK_SWAP_SCRIPT, [path, token, version, encoded])];
  const part = partPath(path, token);
  const pieces: string[] = [];
  for (let start = 0; start < encoded.length; start += UPLOAD_CHUNK_CHARS) {
    pieces.push(encoded.slice(start, start + UPLOAD_CHUNK_CHARS));
  }
  return [
    ...pieces.map((piece, index) => sh(index === 0 ? YSK_PART_FIRST_SCRIPT : YSK_PART_NEXT_SCRIPT, [part, piece])),
    sh(YSK_SWAP_SCRIPT, [path, token, version]),
  ];
}

/** The command that removes a write's part file, for a write whose commands did not all go. */
export function yskCleanupCommand(path: string, token: string): string {
  writablePath(path);
  if (!TOKEN.test(token)) throw new Error(`Not a token: ${token}`);
  return sh(YSK_CLEANUP_SCRIPT, [partPath(path, token)]);
}

/** What the swap said: written with the new version, or stale. Null: anything else, a failed write. */
export type YskWrite = { kind: 'written'; version: string } | { kind: 'stale' };

export function parseYskWrite(stdout: string): YskWrite | null {
  const lines = stdout.trim().split('\n').map((line) => line.trim());
  if (lines.length === 1 && lines[0] === YSK_STALE) return { kind: 'stale' };
  if (lines.length === 2 && lines[0] === YSK_WRITTEN && VERSION.test(lines[1] ?? '')) {
    return { kind: 'written', version: lines[1]! };
  }
  return null;
}
