/**
 * Heads Up's store on the host: finding it, reading it, and writing it back.
 *
 * Built like the host theme's fetch (`src/lib/theme/hostTheme.ts`): one
 * bounded `sh` command each, a `cksum` version so an unchanged file costs a
 * line, and a sentinel for each thing that is not a file to read, so "there is
 * no Heads Up here" and "the check failed" never look alike.
 *
 * The scripts hold no single quote, so quoting each for `sh -c` is a plain
 * wrap, and everything that varies (the path, the version, the JSON) goes in
 * as a positional argument through `shellQuote`, never into the script.
 */
import { shellQuote, withPath } from '../herdr/shell';

/** The mod's plugin name: its store file is `headsup_<marketplace>-<hash>.json`. */
export const HEADSUP_STORE_GLOB = 'headsup_*.json';

/** Claude Code's plugin store, under its config folder. */
const STORE_DIR = '"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/store"';

/**
 * The largest store the app reads or writes. The mod caps its list at 200
 * items of a line and a few sentences each, well under this; a file past it
 * is not one to buffer whole on a phone.
 */
export const HEADSUP_MAX_BYTES = 512 * 1024;

export const HEADSUP_NONE = 'HERDRCHAT_HEADSUP_NONE';
export const HEADSUP_AT = 'HERDRCHAT_HEADSUP_AT';
export const HEADSUP_MISSING = 'HERDRCHAT_HEADSUP_MISSING';
export const HEADSUP_NOT_FILE = 'HERDRCHAT_HEADSUP_NOT_FILE';
export const HEADSUP_UNREADABLE = 'HERDRCHAT_HEADSUP_UNREADABLE';
export const HEADSUP_TOO_LARGE = 'HERDRCHAT_HEADSUP_TOO_LARGE';
/** The line after which the rest of the output is the file, byte for byte. */
export const HEADSUP_BEGIN = 'HERDRCHAT_HEADSUP_BEGIN';
/** A write found the file changed since it was read, and changed nothing. */
export const HEADSUP_STALE = 'HERDRCHAT_HEADSUP_STALE';
/** A write landed; the next line is the file's new version. */
export const HEADSUP_WRITTEN = 'HERDRCHAT_HEADSUP_WRITTEN';

/** Stands for "no version known", which no `cksum` prints. */
const NO_VERSION = '-';
/** What `cksum` prints: a CRC and a byte count. */
const VERSION = /^\d+ \d+$/;
/** A store path as detection prints it: absolute, one line, the mod's file name. */
const STORE_PATH = /^\/[^\n]*\/headsup_[^/\n]*\.json$/;
/** A temp file's token: letters and digits only. */
const TOKEN = /^[A-Za-z0-9]{1,32}$/;

const sh = (script: string, args: readonly string[]) =>
  withPath(`sh -c ${shellQuote(script)} sh${args.map((arg) => ` ${shellQuote(arg)}`).join('')}`);

// MARK: - Detect

/**
 * Whether the host has a Heads Up store: the newest regular, readable
 * `headsup_*.json` in the plugin store (the marketplace part of the name
 * depends on how the mod was installed, the hash on where, so there may be
 * more than one), or a sentinel. `[ -f ]` refuses a FIFO or a device before
 * anything could read it.
 */
export const HEADSUP_DETECT_SCRIPT = [
  `d=${STORE_DIR}`,
  'b=',
  `for f in "$d"/${HEADSUP_STORE_GLOB}; do`,
  '  if [ -f "$f" ] && [ -r "$f" ]; then',
  '    if [ -z "$b" ] || [ "$f" -nt "$b" ]; then b=$f; fi',
  '  fi',
  'done',
  `if [ -z "$b" ]; then echo ${HEADSUP_NONE}; else echo "${HEADSUP_AT} $b"; fi`,
].join('\n');

export function headsUpDetectCommand(): string {
  return sh(HEADSUP_DETECT_SCRIPT, []);
}

/** What detection found. Null: not something the command prints, a failed check. */
export type HeadsUpDetect = { kind: 'none' } | { kind: 'found'; path: string };

export function parseHeadsUpDetect(stdout: string): HeadsUpDetect | null {
  const line = stdout.trim();
  if (line === HEADSUP_NONE) return { kind: 'none' };
  if (!line.startsWith(`${HEADSUP_AT} `)) return null;
  const path = line.slice(HEADSUP_AT.length + 1);
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
export const HEADSUP_READ_SCRIPT = [
  'f=$1',
  `if [ ! -e "$f" ]; then echo ${HEADSUP_MISSING}; exit 0; fi`,
  `if [ ! -f "$f" ]; then echo ${HEADSUP_NOT_FILE}; exit 0; fi`,
  `if [ ! -r "$f" ]; then echo ${HEADSUP_UNREADABLE}; exit 0; fi`,
  'c=$(mktemp) || exit 1',
  'trap "rm -f \\"$c\\"" EXIT',
  `head -c ${HEADSUP_MAX_BYTES + 1} "$f" > "$c" || exit 1`,
  'v=$(cksum < "$c")',
  'echo "$v"',
  'if [ "$v" = "$2" ]; then exit 0; fi',
  `if [ "\${v##* }" -gt ${HEADSUP_MAX_BYTES} ]; then echo ${HEADSUP_TOO_LARGE}; exit 0; fi`,
  `echo ${HEADSUP_BEGIN}`,
  'cat "$c"',
].join('\n');

export function headsUpReadCommand(path: string, lastVersion: string | null): string {
  if (!isStorePath(path)) throw new Error(`Not a Heads Up store: ${path}`);
  return sh(HEADSUP_READ_SCRIPT, [path, lastVersion !== null && VERSION.test(lastVersion) ? lastVersion : NO_VERSION]);
}

export type HeadsUpRead =
  | { kind: 'unchanged' }
  | { kind: 'present'; version: string; text: string }
  /** Gone since detection: the host has no Heads Up until it is found again. */
  | { kind: 'missing' }
  /** There, but not to be read: not a file, not readable, or past the cap. */
  | { kind: 'unreadable'; version: string | null };

/** The read's stdout. Null: not something the command prints, a failed read. */
export function parseHeadsUpRead(stdout: string, lastVersion: string | null): HeadsUpRead | null {
  const firstBreak = stdout.indexOf('\n');
  const first = (firstBreak === -1 ? stdout : stdout.slice(0, firstBreak)).trim();
  const rest = firstBreak === -1 ? '' : stdout.slice(firstBreak + 1);
  const alone = (result: HeadsUpRead) => (rest.trim().length === 0 ? result : null);

  if (first === HEADSUP_MISSING) return alone({ kind: 'missing' });
  if (first === HEADSUP_NOT_FILE || first === HEADSUP_UNREADABLE) return alone({ kind: 'unreadable', version: null });
  if (!VERSION.test(first)) return null;
  if (rest.trim().length === 0) return first === lastVersion ? { kind: 'unchanged' } : null;
  if (rest.trim() === HEADSUP_TOO_LARGE) return { kind: 'unreadable', version: first };
  if (!rest.startsWith(`${HEADSUP_BEGIN}\n`) && rest !== HEADSUP_BEGIN) return null;
  return { kind: 'present', version: first, text: rest.slice(HEADSUP_BEGIN.length + 1) };
}

// MARK: - Write

/**
 * Most a command may carry of the file, in UTF-8 bytes once quoted. A host
 * shell takes the whole command as one argument, which Linux caps at 128 KB
 * (`MAX_ARG_STRLEN`); this leaves room for the script and the PATH prefix,
 * as the picture upload does. A larger file goes over in pieces.
 */
export const HEADSUP_WRITE_CHUNK_BYTES = 96 * 1024;

/** Starts the temp file with the first piece (`$1` the temp file, `$2` the piece). */
export const HEADSUP_PART_FIRST_SCRIPT = 'umask 077\nprintf %s "$2" > "$1"';
/** Adds a later piece. */
export const HEADSUP_PART_NEXT_SCRIPT = 'printf %s "$2" >> "$1"';

/**
 * The compare-and-swap: `$1` the store, `$2` the temp file beside it, `$3`
 * the version the change was made against, `$4` (when the whole file fits in
 * one command) the contents to put in the temp file first. Moves the temp
 * file into place only while the store still has that version, and prints the
 * new one; otherwise removes it, prints the stale sentinel and changes nothing.
 * A `mv` within one folder replaces the file in one step, so no session ever
 * reads half of it. The version printed is that of the bytes moved.
 */
export const HEADSUP_SWAP_SCRIPT = [
  'f=$1; t=$2',
  'if [ $# -ge 4 ]; then umask 077; printf %s "$4" > "$t" || exit 1; fi',
  `if [ ! -f "$f" ]; then rm -f "$t"; echo ${HEADSUP_STALE}; exit 0; fi`,
  `v=$(head -c ${HEADSUP_MAX_BYTES + 1} "$f" | cksum)`,
  `if [ "$v" != "$3" ]; then rm -f "$t"; echo ${HEADSUP_STALE}; exit 0; fi`,
  // The version of the bytes moved into place, taken before the move: one
  // taken after could be another writer's, which the app would then hold
  // beside its own contents and later write over.
  `n=$(head -c ${HEADSUP_MAX_BYTES + 1} "$t" | cksum)`,
  'mv -f "$t" "$f" || { rm -f "$t"; exit 1; }',
  `echo ${HEADSUP_WRITTEN}`,
  'echo "$n"',
].join('\n');

/** Removes a write's temp file (`$1`) after a piece failed to go. */
export const HEADSUP_CLEANUP_SCRIPT = 'rm -f "$1"';

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

/**
 * Split text into pieces whose quoted form fits `maxBytes`, never inside a
 * character: a single quote costs four bytes once `shellQuote` has escaped it.
 */
export function chunkForShell(value: string, maxBytes: number = HEADSUP_WRITE_CHUNK_BYTES): string[] {
  const pieces: string[] = [];
  let piece = '';
  let bytes = 0;
  for (const char of value) {
    const cost = char === "'" ? 4 : codePointBytes(char.codePointAt(0) ?? 0);
    if (bytes + cost > maxBytes && piece !== '') {
      pieces.push(piece);
      piece = '';
      bytes = 0;
    }
    piece += char;
    bytes += cost;
  }
  if (piece !== '' || pieces.length === 0) pieces.push(piece);
  return pieces;
}

/** The temp file a write uses, beside the store, which the mod's glob does not match. */
export function tempPath(path: string, token: string): string {
  return `${path}.herdrchat-${token}.tmp`;
}

/**
 * The commands that write `json` over the store at `path`, in order, if and
 * only if it still has `version`: the pieces into a temp file, then the swap.
 * One command when it fits in one, which is nearly always.
 */
export function headsUpWriteCommands(path: string, version: string, json: string, token: string): string[] {
  if (!isStorePath(path)) throw new Error(`Not a Heads Up store: ${path}`);
  if (!VERSION.test(version)) throw new Error(`Not a version: ${version}`);
  if (!TOKEN.test(token)) throw new Error(`Not a token: ${token}`);
  const temp = tempPath(path, token);
  const pieces = chunkForShell(json);
  if (pieces.length === 1) return [sh(HEADSUP_SWAP_SCRIPT, [path, temp, version, pieces[0] ?? ''])];
  return [
    ...pieces.map((piece, index) => sh(index === 0 ? HEADSUP_PART_FIRST_SCRIPT : HEADSUP_PART_NEXT_SCRIPT, [temp, piece])),
    sh(HEADSUP_SWAP_SCRIPT, [path, temp, version]),
  ];
}

/** The command that removes a write's temp file, for a write whose pieces did not all go. */
export function headsUpCleanupCommand(path: string, token: string): string {
  if (!isStorePath(path)) throw new Error(`Not a Heads Up store: ${path}`);
  if (!TOKEN.test(token)) throw new Error(`Not a token: ${token}`);
  return sh(HEADSUP_CLEANUP_SCRIPT, [tempPath(path, token)]);
}

/** What the swap said: written with the new version, or stale. Null: anything else, a failed write. */
export type HeadsUpWrite = { kind: 'written'; version: string } | { kind: 'stale' };

export function parseHeadsUpWrite(stdout: string): HeadsUpWrite | null {
  const lines = stdout.trim().split('\n').map((line) => line.trim());
  if (lines.length === 1 && lines[0] === HEADSUP_STALE) return { kind: 'stale' };
  if (lines.length === 2 && lines[0] === HEADSUP_WRITTEN && VERSION.test(lines[1] ?? '')) {
    return { kind: 'written', version: lines[1]! };
  }
  return null;
}
