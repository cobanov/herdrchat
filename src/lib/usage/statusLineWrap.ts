import { shellQuote } from '@/lib/herdr/shell';

/**
 * Installing, and taking back out, the status line wrapper that saves Claude's
 * plan usage for the app (`planUsage.ts`).
 *
 * Claude Code runs `statusLine.command` from `~/.claude/settings.json` with
 * the session's state as JSON on stdin, `rate_limits` among it, and shows what
 * the command prints. The wrapper takes that place: it saves the input to
 * `usage.json`, then runs the status line it replaced with the same input, so
 * the person's own status line (ccstatusline, a script) shows as before.
 *
 * Pure: these take the files' text and return the text to write. A settings
 * file that is not JSON is refused rather than replaced, because rewriting it
 * would lose every other setting in it.
 */

export const WRAPPER_FILE = '.cache/herdrchat/statusline.sh';
/**
 * The status line the wrapper replaced, kept to put back (`SavedOriginal`).
 * Not under `~/.cache`, which cleaners are allowed to empty: with it gone,
 * turning off once removed the status line along with the wrapper.
 */
export const ORIGINAL_FILE = '.local/share/herdrchat/statusline-original.json';
export const SETTINGS_FILE = '.claude/settings.json';
/** What `statusLine.command` says once wrapped; `~` is expanded by the shell Claude runs it in. */
export const WRAPPER_COMMAND = `sh ~/${WRAPPER_FILE}`;

export type StatusLine = Record<string, unknown>;

export type SettingsEdit =
  | { ok: true; settings: string; original: StatusLine | null }
  | { ok: false; code: 'settings_unreadable'; message: string };

function parseSettings(text: string | null): Record<string, unknown> | null {
  if (text === null || text.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function statusLineOf(settings: Record<string, unknown>): StatusLine | null {
  const line = settings.statusLine;
  return typeof line === 'object' && line !== null && !Array.isArray(line) ? (line as StatusLine) : null;
}

const unreadable: SettingsEdit = {
  ok: false,
  code: 'settings_unreadable',
  message: "This host's Claude settings (~/.claude/settings.json) are not valid JSON, so HerdrChat left them alone.",
};

export function isWrapped(settingsText: string | null): boolean {
  const settings = parseSettings(settingsText);
  return settings !== null && statusLineOf(settings)?.command === WRAPPER_COMMAND;
}

/**
 * Settings with the wrapper as the status line, and the status line it
 * replaces. `settingsText` null means there is no settings file yet. Already
 * wrapped, nothing changes and `original` is null: the saved one stands.
 */
export function wrapSettings(settingsText: string | null): SettingsEdit {
  const settings = parseSettings(settingsText);
  if (settings === null) return unreadable;
  const original = statusLineOf(settings);
  if (original?.command === WRAPPER_COMMAND) return { ok: true, settings: settingsText ?? '{}', original: null };
  // The original's other fields (padding, refresh) carry over to the wrapper.
  const statusLine = { ...original, type: 'command', command: WRAPPER_COMMAND };
  return { ok: true, settings: `${JSON.stringify({ ...settings, statusLine }, null, 2)}\n`, original };
}

/**
 * Settings with the saved status line back in place, or none if there was
 * none. Settings whose status line is no longer the wrapper are the
 * person's own choice since, and stay as they are.
 */
export function unwrapSettings(settingsText: string | null, original: StatusLine | null): SettingsEdit {
  const settings = parseSettings(settingsText);
  if (settings === null) return unreadable;
  if (statusLineOf(settings)?.command !== WRAPPER_COMMAND) return { ok: true, settings: settingsText ?? '{}', original: null };
  const { statusLine: _wrapper, ...rest } = settings;
  const restored = original === null ? rest : { ...rest, statusLine: original };
  return { ok: true, settings: `${JSON.stringify(restored, null, 2)}\n`, original: null };
}

/**
 * What `ORIGINAL_FILE` keeps: the status line to put back (null for none),
 * and whether the install created `settings.json`, so that turning off
 * removes a file it would otherwise leave behind as `{}`.
 */
export interface SavedOriginal {
  statusLine: StatusLine | null;
  createdSettings: boolean;
}

export function originalFileText(saved: SavedOriginal): string {
  return `${JSON.stringify(saved)}\n`;
}

/**
 * `ORIGINAL_FILE`'s text read back, or null when there is none or it cannot
 * be read. Null is "not known", never "there was no status line": the caller
 * must not put back nothing on the strength of a file it could not read.
 */
export function parseOriginal(text: string | null): SavedOriginal | null {
  if (text === null) return null;
  const parsed = parseSettings(text);
  if (parsed === null || !('statusLine' in parsed)) return null;
  const line = parsed.statusLine;
  if (line !== null && statusLineOf(parsed) === null) return null;
  return { statusLine: statusLineOf(parsed), createdSettings: parsed.createdSettings === true };
}

/**
 * How the wrapper's last line, which runs the status line it replaced, starts
 * (`wrapperScript`). The command after it is quoted and may span lines.
 */
const RUN_ORIGINAL = `printf '%s' "$input" | sh -c `;

/** A `shellQuote`d argument back, or null for text it did not write. */
function shellUnquote(quoted: string): string | null {
  if (quoted.length < 2 || !quoted.startsWith("'") || !quoted.endsWith("'")) return null;
  const inner = quoted.slice(1, -1).replaceAll(`'\\''`, '\u0000');
  return inner.includes("'") ? null : inner.replaceAll('\u0000', "'");
}

/**
 * The status line to put back, recovered from the wrapper when the saved one
 * is gone: the wrapper holds its command, and the wrapped settings kept its
 * other fields (`wrapSettings`). Null when the wrapper is not one this wrote.
 * Whether the install created the settings is not in either, so it is false.
 */
export function originalFromWrapper(wrapperText: string, wrappedSettingsText: string): SavedOriginal | null {
  if (!wrapperText.startsWith('#!/bin/sh\n# Installed by HerdrChat')) return null;
  const settings = parseSettings(wrappedSettingsText);
  const wrapped = settings === null ? null : statusLineOf(settings);
  const at = wrapperText.indexOf(`\n${RUN_ORIGINAL}`);
  if (at === -1) return { statusLine: null, createdSettings: false };
  const command = shellUnquote(wrapperText.slice(at + 1 + RUN_ORIGINAL.length).replace(/\n$/, ''));
  if (command === null) return null;
  return { statusLine: { ...wrapped, type: 'command', command }, createdSettings: false };
}

/** Settings text that says nothing at all, which Claude Code reads as no file. */
export function isEmptySettings(settingsText: string): boolean {
  const settings = parseSettings(settingsText);
  return settings !== null && Object.keys(settings).length === 0;
}

/**
 * The wrapper: save the input, then hand the same input to the status line it
 * replaced and print what that prints. The usage file is written through a
 * temporary file and a rename, so the app never reads half of one, and two
 * sessions redrawing at once each write their own temporary file.
 */
export function wrapperScript(original: StatusLine | null): string {
  const command = typeof original?.command === 'string' && original.command.trim() !== '' ? original.command : null;
  return [
    '#!/bin/sh',
    "# Installed by HerdrChat as Claude Code's status line. It saves the status line's",
    '# input, which carries your plan usage, for the app to show, then runs the status',
    '# line it replaced. Turn off "Claude usage" in HerdrChat to put that one back.',
    'input=$(cat)',
    'dir="$HOME/.cache/herdrchat"',
    'tmp="$dir/usage.json.$$"',
    '{ mkdir -p "$dir" && printf \'{"captured_at":%s,"status":%s}\\n\' "$(date +%s)" "$input" > "$tmp" && mv -f "$tmp" "$dir/usage.json"; } 2>/dev/null || rm -f "$tmp"',
    command === null ? '' : `${RUN_ORIGINAL}${shellQuote(command)}`,
    '',
  ].join('\n');
}
