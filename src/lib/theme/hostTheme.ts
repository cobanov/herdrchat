/**
 * Fetching a host's theme.json: one command, and what its output means.
 *
 * The check runs often (piggybacked on the chat list's poll) and almost always
 * finds nothing new, so it is built to cost one round-trip and a few bytes when
 * nothing changed: the host prints a fingerprint of the file, and the file
 * itself only when that differs from the one the phone already has. A missing
 * file prints a sentinel, so "there is no theme" and "the check failed" never
 * look alike — the first resets the app to its own colours, the second changes
 * nothing and is tried again on the next poll.
 */
import { shellQuote, withPath } from '../herdr/shell';
import type { HostThemeFile, UnreadableReason } from './resolve';
import { THEME_DIR, THEME_FILE, THEME_MAX_BYTES } from './schema';

export const THEME_MISSING = 'HERDRCHAT_THEME_MISSING';
export const THEME_UNREADABLE = 'HERDRCHAT_THEME_UNREADABLE';
export const THEME_NOT_FILE = 'HERDRCHAT_THEME_NOT_FILE';
export const THEME_TOO_LARGE = 'HERDRCHAT_THEME_TOO_LARGE';
/** The line after which the rest of the output is the file, byte for byte. */
export const THEME_BEGIN = 'HERDRCHAT_THEME_BEGIN';

/** Stands for "no version known" in the command, where it can never equal a real one. */
const NO_VERSION = '-';

/** What `cksum` prints: a CRC and a byte count. */
const VERSION = /^\d+ \d+$/;

/** What a held version may be to go into the script: a host's, or an old row's `mtime <n>`. Anything else is sent as none. */
const SAFE_VERSION = /^[a-z0-9 ]+$/;

const THEME_PATH = `"$HOME/${THEME_DIR}/${THEME_FILE}"`;

/**
 * The fetch command. `lastVersion` is the version of the file the phone
 * already holds, or null to force the contents (first check, Reload theme).
 *
 * Bounded at every step, because the output is buffered whole on the phone
 * and a check that never ends drops the host's SSH client at the timeout:
 * `[ -f ]` refuses a FIFO, a device or a directory (a symlink to `/dev/zero`
 * included) before anything reads it, and `head -c` never reads more than one
 * byte past `THEME_MAX_BYTES`.
 *
 * The version is `cksum` of those bytes: a CRC of the contents and their
 * length, so two writes within one second, which a whole-second mtime could
 * not tell apart, still differ. `cksum` is POSIX and on every host the app
 * supports. A file past the bound is reported, not sent; its version still
 * lets an unchanged one cost a line.
 *
 * The script holds no single quote, so its quoting for `sh -c` is a plain wrap.
 */
export function themeFetchCommand(lastVersion: string | null): string {
  const script = [
    `f=${THEME_PATH}`,
    `if [ ! -e "$f" ]; then echo ${THEME_MISSING}; exit 0; fi`,
    `if [ ! -f "$f" ]; then echo ${THEME_NOT_FILE}; exit 0; fi`,
    `if [ ! -r "$f" ]; then echo ${THEME_UNREADABLE}; exit 0; fi`,
    `v=$(head -c ${THEME_MAX_BYTES + 1} "$f" | cksum)`,
    'echo "$v"',
    `if [ "$v" = "${lastVersion !== null && SAFE_VERSION.test(lastVersion) ? lastVersion : NO_VERSION}" ]; then exit 0; fi`,
    `if [ "\${v##* }" -gt ${THEME_MAX_BYTES} ]; then echo ${THEME_TOO_LARGE}; exit 0; fi`,
    `echo ${THEME_BEGIN}`,
    `head -c ${THEME_MAX_BYTES} "$f"`,
  ].join('\n');
  return withPath(`sh -c ${shellQuote(script)}`);
}

/** A fetch's answer: the file as it now is, or that it is the one already held. */
export type ThemeFetchResult = { kind: 'unchanged' } | HostThemeFile;

/**
 * Read the fetch command's stdout. Null means the output is not something the
 * command prints, which the caller treats as a failed check: keep the theme it
 * has and try again later.
 */
export function parseThemeFetch(stdout: string, lastVersion: string | null): ThemeFetchResult | null {
  const firstBreak = stdout.indexOf('\n');
  const first = (firstBreak === -1 ? stdout : stdout.slice(0, firstBreak)).trim();
  const rest = firstBreak === -1 ? '' : stdout.slice(firstBreak + 1);
  const alone = (result: ThemeFetchResult) => (rest.trim().length === 0 ? result : null);

  if (first === THEME_MISSING) return alone({ kind: 'missing' });
  if (first === THEME_NOT_FILE) return alone({ kind: 'unreadable', reason: 'notFile', version: null });
  if (first === THEME_UNREADABLE) return alone({ kind: 'unreadable', reason: 'permissions', version: null });
  if (!VERSION.test(first)) return null;
  const version = first;

  if (rest.trim().length === 0) return version === lastVersion ? { kind: 'unchanged' } : null;
  if (rest.trim() === THEME_TOO_LARGE) return { kind: 'unreadable', reason: 'tooLarge', version };
  if (!rest.startsWith(`${THEME_BEGIN}\n`) && rest !== THEME_BEGIN) return null;
  return { kind: 'present', version, text: rest.slice(THEME_BEGIN.length + 1) };
}

/** The version to send with the next check: that of a file read, or of one too large to read. */
export function knownVersion(file: HostThemeFile): string | null {
  return file.kind === 'missing' ? null : file.version;
}

/** The file after a fetch, given the one held before. */
export function afterFetch(previous: HostThemeFile, result: ThemeFetchResult): HostThemeFile {
  return result.kind === 'unchanged' ? previous : result;
}

/**
 * Reset to default: move theme.json aside to the first free name of
 * theme.json.bak, theme.json.bak.1, theme.json.bak.2 and so on. Renamed rather
 * than deleted because the theme may be an hour of someone's agent's work, and
 * the reset is one tap away; never over an older backup, since that one is
 * the same kind of work, and a second reset used to destroy it.
 */
export function themeResetCommand(): string {
  const script = [
    `f=${THEME_PATH}`,
    'if [ ! -e "$f" ]; then exit 0; fi',
    'b="$f.bak"; n=1',
    'while [ -e "$b" ]; do b="$f.bak.$n"; n=$((n + 1)); done',
    'mv "$f" "$b"',
  ].join('\n');
  return withPath(`sh -c ${shellQuote(script)}`);
}

/** How a held file is stored in the settings table (`hostTheme.<connectionId>`). */
export function serializeThemeFile(file: HostThemeFile): string {
  return JSON.stringify(file);
}

const REASONS: readonly string[] = ['permissions', 'notFile', 'tooLarge'] satisfies UnreadableReason[];

/**
 * The stored file, or null when the stored text is not one (corruption).
 *
 * A row from before versions held a whole-second `mtime`. It is read with a
 * version no host prints, so the next check fetches the contents once and
 * stores the new kind of row.
 */
export function deserializeThemeFile(text: string | null | undefined): HostThemeFile | null {
  if (text === null || text === undefined) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.kind === 'missing') return { kind: 'missing' };
  const legacy = typeof record.mtime === 'number' && Number.isFinite(record.mtime) ? `mtime ${record.mtime}` : null;
  const version = typeof record.version === 'string' ? record.version : legacy;
  if (record.kind === 'unreadable') {
    const reason = typeof record.reason === 'string' && REASONS.includes(record.reason) ? (record.reason as UnreadableReason) : 'permissions';
    if (record.reason === undefined && legacy === null) return null;
    return { kind: 'unreadable', reason, version: reason === 'tooLarge' ? version : null };
  }
  if (record.kind === 'present' && typeof record.text === 'string' && version !== null) {
    return { kind: 'present', version, text: record.text };
  }
  return null;
}
