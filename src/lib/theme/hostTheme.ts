/**
 * Fetching a host's theme.json: one command, and what its output means.
 *
 * The check runs often (piggybacked on the chat list's poll) and almost always
 * finds nothing new, so it is built to cost one round-trip and a few bytes when
 * nothing changed: the host prints the file's mtime, and the file itself only
 * when that differs from the one the phone already has. A missing file prints
 * a sentinel, so "there is no theme" and "the check failed" never look alike —
 * the first resets the app to its own colours, the second changes nothing and
 * is tried again on the next poll.
 */
import { shellQuote, withPath } from '../herdr/shell';
import type { HostThemeFile } from './resolve';
import { THEME_DIR, THEME_FILE } from './schema';

export const THEME_MISSING = 'HERDRCHAT_THEME_MISSING';
export const THEME_UNREADABLE = 'HERDRCHAT_THEME_UNREADABLE';
/** The line after which the rest of the output is the file, byte for byte. */
export const THEME_BEGIN = 'HERDRCHAT_THEME_BEGIN';

/** Stands for "no mtime known" in the command, where it can never equal a real one. */
const NO_MTIME = '-';

const THEME_PATH = `"$HOME/${THEME_DIR}/${THEME_FILE}"`;

/**
 * The fetch command. `lastMtime` is the mtime of the file the phone already
 * holds, or null to force the contents (first check, Reload theme, or the last
 * check found the file unreadable).
 *
 * `stat -c %Y` is GNU, `stat -f %m` is BSD and macOS; whichever the host has
 * answers, the other's complaint goes to /dev/null. The script holds no single
 * quote, so its quoting for `sh -c` is a plain wrap.
 */
export function themeFetchCommand(lastMtime: number | null): string {
  const script = [
    `f=${THEME_PATH}`,
    `if [ ! -e "$f" ]; then echo ${THEME_MISSING}; exit 0; fi`,
    'm=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f")',
    'echo "$m"',
    `if [ "$m" = "${lastMtime === null ? NO_MTIME : String(lastMtime)}" ]; then exit 0; fi`,
    `if [ ! -r "$f" ]; then echo ${THEME_UNREADABLE}; exit 0; fi`,
    `echo ${THEME_BEGIN}`,
    'cat "$f"',
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
export function parseThemeFetch(stdout: string, lastMtime: number | null): ThemeFetchResult | null {
  const firstBreak = stdout.indexOf('\n');
  const first = (firstBreak === -1 ? stdout : stdout.slice(0, firstBreak)).trim();
  const rest = firstBreak === -1 ? '' : stdout.slice(firstBreak + 1);

  if (first === THEME_MISSING) return rest.trim().length === 0 ? { kind: 'missing' } : null;
  if (!/^\d+$/.test(first)) return null;
  const mtime = Number(first);

  if (rest.trim().length === 0) return mtime === lastMtime ? { kind: 'unchanged' } : null;
  if (rest.trim() === THEME_UNREADABLE) return { kind: 'unreadable', mtime };
  if (!rest.startsWith(`${THEME_BEGIN}\n`) && rest !== THEME_BEGIN) return null;
  return { kind: 'present', mtime, text: rest.slice(THEME_BEGIN.length + 1) };
}

/** The mtime to send with the next check. Only a file actually held counts. */
export function knownMtime(file: HostThemeFile): number | null {
  return file.kind === 'present' ? file.mtime : null;
}

/** The file after a fetch, given the one held before. */
export function afterFetch(previous: HostThemeFile, result: ThemeFetchResult): HostThemeFile {
  return result.kind === 'unchanged' ? previous : result;
}

/**
 * Reset to default: move theme.json aside as theme.json.bak, replacing an
 * older .bak. Renamed rather than deleted because the theme may be an hour of
 * someone's agent's work, and the reset is one tap away.
 */
export function themeResetCommand(): string {
  const script = `f=${THEME_PATH}; if [ -e "$f" ]; then mv -f "$f" "$f.bak"; fi`;
  return withPath(`sh -c ${shellQuote(script)}`);
}

/** How a held file is stored in the settings table (`hostTheme.<connectionId>`). */
export function serializeThemeFile(file: HostThemeFile): string {
  return JSON.stringify(file);
}

/** The stored file, or null when the stored text is not one (an older format, corruption). */
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
  if (typeof record.mtime !== 'number' || !Number.isFinite(record.mtime)) return null;
  if (record.kind === 'unreadable') return { kind: 'unreadable', mtime: record.mtime };
  if (record.kind === 'present' && typeof record.text === 'string') {
    return { kind: 'present', mtime: record.mtime, text: record.text };
  }
  return null;
}
