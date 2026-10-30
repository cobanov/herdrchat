/**
 * Claude plan usage over any transport: read the usage file the status line
 * wrapper saves, and install or take out that wrapper (`statusLineWrap.ts`).
 *
 * Each is a round-trip of a small `sh` script, built and read by pure
 * functions below so the scripts can be pinned by tests and run for real
 * against a temporary home. The scripts run under `sh -c`, so an `exit` in
 * them ends that shell and not the session the transport marks as done.
 *
 * Installing and taking out are two round-trips each: one reads the settings
 * and the saved status line, the app decides what to write, and the second
 * writes it. Between the two the person, or Claude Code, may have saved the
 * settings; the second refuses to write unless the file is still the one that
 * was read (its `cksum`), so nothing written in between is lost.
 *
 * Nothing here throws. A failure is `{ ok: false, code, message }`, with the
 * message already in the words the footer shows.
 */
import type { SshFailureCode } from '../../../modules/herdr-ssh/src';
import { POLL_TIMEOUT_MS, SEND_TIMEOUT_MS } from '../herdr/timeouts';
import type { HerdrTransport } from '../herdr/transport';
import { shellQuote, withPath } from '../herdr/shell';
import { parseUsageFile, USAGE_FILE, type PlanUsage } from './planUsage';
import {
  isEmptySettings,
  isWrapped,
  ORIGINAL_FILE,
  originalFileText,
  originalFromWrapper,
  parseOriginal,
  SETTINGS_FILE,
  unwrapSettings,
  WRAPPER_FILE,
  wrapperScript,
  wrapSettings,
  type SavedOriginal,
} from './statusLineWrap';

// MARK: - Reading the usage file

/**
 * The status line's input is a couple of kilobytes. The bound only keeps a
 * file that is not one (a log redirected there by mistake) from coming over a
 * phone's radio whole.
 */
const USAGE_MAX_BYTES = 65_536;

export const USAGE_MISSING = '@@herdrchat:usage-missing';
export const USAGE_BEGIN = '@@herdrchat:usage';

/** Print the usage file after a marker line, or a line saying there is none. */
export function usageReadCommand(): string {
  const script = [
    `f="$HOME/${USAGE_FILE}"`,
    `if [ ! -f "$f" ]; then echo ${USAGE_MISSING}; exit 0; fi`,
    `echo ${USAGE_BEGIN}`,
    `head -c ${USAGE_MAX_BYTES} "$f"`,
  ].join('\n');
  return withPath(`sh -c ${shellQuote(script)}`);
}

/**
 * What a read found: the windows still in force at `nowSeconds`, or null when
 * there is nothing to show yet (no file, or none this reads). Null for the
 * whole result is a failed read: output the command does not print.
 */
export function parseUsageRead(stdout: string, nowSeconds: number): { usage: PlanUsage | null } | null {
  const firstBreak = stdout.indexOf('\n');
  const first = (firstBreak === -1 ? stdout : stdout.slice(0, firstBreak)).trim();
  if (first === USAGE_MISSING) return { usage: null };
  if (first !== USAGE_BEGIN) return null;
  return { usage: parseUsageFile(firstBreak === -1 ? '' : stdout.slice(firstBreak + 1), nowSeconds) };
}

/** Read the usage file. Null is a failed read, which the caller treats as "keep what you have". */
export async function fetchPlanUsage(
  transport: HerdrTransport,
  nowSeconds: number
): Promise<{ usage: PlanUsage | null } | null> {
  try {
    const result = await transport.exec(usageReadCommand(), POLL_TIMEOUT_MS);
    if (!result.ok || result.exitCode !== 0) return null;
    return parseUsageRead(result.stdout, nowSeconds);
  } catch {
    return null;
  }
}

// MARK: - Installing and taking out the wrapper

export type UsageSetupCode =
  | 'settings_unreadable'
  | 'original_missing'
  | 'settings_changed'
  | 'command_failed'
  | 'unexpected_output'
  | SshFailureCode;

export type UsageSetupResult = { ok: true } | { ok: false; code: UsageSetupCode; message: string };

/** One of the two files the first round-trip reads, as the host had it. */
export type HostFile =
  | { kind: 'none' }
  /** There, but not a regular file this user can read. */
  | { kind: 'unreadable' }
  /** `sum` is its `cksum`, which the write compares against before replacing it. */
  | { kind: 'present'; text: string; sum: string };

export interface StatusLineFiles {
  settings: HostFile;
  original: HostFile;
  /** Read for the status line it runs, should the saved one be gone. */
  wrapper: HostFile;
}

const SETTINGS_SECTION = '@@herdrchat:settings';
const ORIGINAL_SECTION = '@@herdrchat:original';
const WRAPPER_SECTION = '@@herdrchat:wrapper';
const DONE = '@@herdrchat:done';
const CHANGED = '@@herdrchat:changed';
/** What the write compares against for a settings file that did not exist. */
const NO_FILE = 'none';
const SUM = /^\d+ \d+$/;

/**
 * Print Claude's settings, the saved status line and the wrapper, each between marker
 * lines, or a line saying it is missing or unreadable. A missing settings
 * file and an empty one are different answers: the first is a host where
 * Claude Code never saved a setting, the second a file someone emptied.
 *
 * Each file is followed by a newline of the script's own before its end
 * marker, so a file with or without a final newline comes back byte for byte.
 */
export function statusLineReadCommand(): string {
  const script = [
    'hc_file() {',
    '  if [ ! -e "$2" ]; then echo "$1 none"; return 0; fi',
    '  if [ ! -f "$2" ] || [ ! -r "$2" ]; then echo "$1 unreadable"; return 0; fi',
    '  echo "$1 begin $(cksum < "$2")"',
    '  cat "$2"',
    '  printf \'\\n%s\\n\' "$1 end"',
    '}',
    `hc_file ${SETTINGS_SECTION} "$HOME/${SETTINGS_FILE}"`,
    `hc_file ${ORIGINAL_SECTION} "$HOME/${ORIGINAL_FILE}"`,
    `hc_file ${WRAPPER_SECTION} "$HOME/${WRAPPER_FILE}"`,
  ].join('\n');
  return withPath(`sh -c ${shellQuote(script)}`);
}

/** One section of the read, and where the next one starts; null for output the command does not print. */
function readSection(stdout: string, from: number, name: string): { file: HostFile; next: number } | null {
  const lineEnd = stdout.indexOf('\n', from);
  if (lineEnd === -1) return null;
  const line = stdout.slice(from, lineEnd);
  if (line === `${name} none`) return { file: { kind: 'none' }, next: lineEnd + 1 };
  if (line === `${name} unreadable`) return { file: { kind: 'unreadable' }, next: lineEnd + 1 };
  const prefix = `${name} begin `;
  if (!line.startsWith(prefix)) return null;
  const sum = line.slice(prefix.length).trim();
  if (!SUM.test(sum)) return null;
  const end = stdout.indexOf(`\n${name} end\n`, lineEnd + 1);
  if (end === -1) return null;
  return { file: { kind: 'present', text: stdout.slice(lineEnd + 1, end), sum }, next: end + `\n${name} end\n`.length };
}

export function parseStatusLineRead(stdout: string): StatusLineFiles | null {
  const settings = readSection(stdout, 0, SETTINGS_SECTION);
  if (settings === null) return null;
  const original = readSection(stdout, settings.next, ORIGINAL_SECTION);
  if (original === null) return null;
  const wrapper = readSection(stdout, original.next, WRAPPER_SECTION);
  if (wrapper === null) return null;
  return { settings: settings.file, original: original.file, wrapper: wrapper.file };
}

/** What the second round-trip writes. Paths are relative to the home folder. */
export interface StatusLineWrite {
  /** Files written whole, before the settings, so the settings never name a wrapper that is not there yet. */
  files: { path: string; text: string }[];
  /** The new settings, `remove` to delete the file, or null to leave them as they are. */
  settings: string | { remove: true } | null;
  /** The settings' `cksum` when read (or `none`): the write refuses a file that changed since. */
  expected: string | null;
  /** Removed last. */
  remove: string[];
}

const home = (path: string) => `"$HOME"/${shellQuote(path)}`;

/**
 * Write each file beside its place and move it in, so Claude Code, which runs
 * the status line every few seconds, never reads half of one. A settings file
 * that is a symlink (dotfiles kept in a repository) keeps its link: the new
 * text goes beside the link's target and moves over that. Writing through the
 * link instead truncated the target first, so a failed write left it cut
 * short. A link it cannot follow is refused. A settings file it is to remove
 * goes only if it is not a link, which would be someone's own.
 */
export function statusLineWriteCommand(write: StatusLineWrite): string {
  const lines = [`s=${home(SETTINGS_FILE)}`];
  if (write.settings !== null && write.expected !== null) {
    const expected = write.expected === NO_FILE || SUM.test(write.expected) ? write.expected : NO_FILE;
    lines.push(
      `if [ -e "$s" ]; then hc_sum=$(cksum < "$s"); else hc_sum=${NO_FILE}; fi`,
      `if [ "$hc_sum" != ${shellQuote(expected)} ]; then echo ${CHANGED}; exit 0; fi`
    );
  }
  const dirs = new Set([...write.files.map((file) => file.path), ...(typeof write.settings === 'string' ? [SETTINGS_FILE] : [])]
    .map((path) => path.slice(0, path.lastIndexOf('/')))
    .filter((dir) => dir !== ''));
  if (dirs.size > 0) lines.push(`mkdir -p ${[...dirs].map(home).join(' ')} || exit 1`);
  for (const file of write.files) {
    lines.push(`printf '%s' ${shellQuote(file.text)} > ${home(`${file.path}.new`)} && mv -f ${home(`${file.path}.new`)} ${home(file.path)} || exit 1`);
  }
  if (typeof write.settings === 'string') {
    lines.push(
      'if [ -L "$s" ]; then t=$(readlink -f "$s" 2>/dev/null); else t="$s"; fi',
      `[ -n "$t" ] || { echo "can't follow the link at ~/${SETTINGS_FILE}" >&2; exit 1; }`,
      `printf '%s' ${shellQuote(write.settings)} > "$t.new" && mv -f "$t.new" "$t" || { rm -f "$t.new"; exit 1; }`
    );
  } else if (write.settings !== null) {
    lines.push('[ -L "$s" ] || rm -f "$s" || exit 1');
  }
  if (write.remove.length > 0) lines.push(`rm -f ${write.remove.map(home).join(' ')}`);
  lines.push(`echo ${DONE}`);
  return withPath(`sh -c ${shellQuote(lines.join('\n'))}`);
}

type UsageSetupFailure = Extract<UsageSetupResult, { ok: false }>;

const UNREADABLE: UsageSetupFailure = {
  ok: false,
  code: 'settings_unreadable',
  message: "HerdrChat can't read this host's Claude settings (~/.claude/settings.json), so it left them alone.",
};

const unexpected: UsageSetupFailure = {
  ok: false,
  code: 'unexpected_output',
  message: "The host answered in a way HerdrChat didn't expect. Try again in a moment.",
};

const ORIGINAL_MISSING: UsageSetupFailure = {
  ok: false,
  code: 'original_missing',
  message: `HerdrChat can't find the status line it replaced on this host (~/${ORIGINAL_FILE}), so it left Claude's settings as they are.`,
};

type Plan = { ok: true; write: StatusLineWrite } | UsageSetupFailure;

/**
 * The status line the install replaced, for settings that name the wrapper:
 * the saved one, or else the one the wrapper runs. Null when neither can be
 * read, and then nothing may be written: putting back "none" would delete
 * the person's status line, and the wrapper may hold the only copy of it.
 */
function savedOriginal(files: StatusLineFiles, wrappedSettings: string): SavedOriginal | null {
  const saved = parseOriginal(files.original.kind === 'present' ? files.original.text : null);
  if (saved !== null) return saved;
  return files.wrapper.kind === 'present' ? originalFromWrapper(files.wrapper.text, wrappedSettings) : null;
}

/**
 * What installing writes. Already wrapped (a second phone, a reinstall), only
 * the wrapper and the saved status line are written again, from the one saved
 * the first time: an app update may carry a new wrapper, and wrapping again
 * would save the wrapper itself as the status line to put back.
 */
export function installPlan(files: StatusLineFiles): Plan {
  if (files.settings.kind === 'unreadable') return UNREADABLE;
  const settingsText = files.settings.kind === 'present' ? files.settings.text : null;
  if (settingsText !== null && isWrapped(settingsText)) {
    const saved = savedOriginal(files, settingsText);
    if (saved === null) return ORIGINAL_MISSING;
    return {
      ok: true,
      write: {
        files: [
          { path: WRAPPER_FILE, text: wrapperScript(saved.statusLine) },
          { path: ORIGINAL_FILE, text: originalFileText(saved) },
        ],
        settings: null,
        expected: null,
        remove: [],
      },
    };
  }
  const edit = wrapSettings(settingsText);
  if (!edit.ok) return edit;
  return {
    ok: true,
    write: {
      files: [
        { path: WRAPPER_FILE, text: wrapperScript(edit.original) },
        { path: ORIGINAL_FILE, text: originalFileText({ statusLine: edit.original, createdSettings: files.settings.kind === 'none' }) },
      ],
      settings: edit.settings,
      expected: files.settings.kind === 'present' ? files.settings.sum : NO_FILE,
      remove: [],
    },
  };
}

/**
 * What taking it out writes: the saved status line back in the settings, if
 * they still name the wrapper, and the wrapper, the saved line and the usage
 * file gone. Settings that name something else since are the person's own
 * choice and stay as they are. Settings the install created, and that say
 * nothing once unwrapped, are removed rather than left behind as `{}`.
 */
export function removePlan(files: StatusLineFiles): Plan {
  if (files.settings.kind === 'unreadable') return UNREADABLE;
  const remove = [WRAPPER_FILE, ORIGINAL_FILE, USAGE_FILE];
  if (files.settings.kind === 'none' || !isWrapped(files.settings.text)) {
    return { ok: true, write: { files: [], settings: null, expected: null, remove } };
  }
  const saved = savedOriginal(files, files.settings.text);
  if (saved === null) return ORIGINAL_MISSING;
  const edit = unwrapSettings(files.settings.text, saved.statusLine);
  if (!edit.ok) return edit;
  const settings = saved.createdSettings && isEmptySettings(edit.settings) ? { remove: true as const } : edit.settings;
  return { ok: true, write: { files: [], settings, expected: files.settings.sum, remove } };
}

/** The write's answer. */
export function parseWriteResult(stdout: string, exitCode: number, stderr: string): UsageSetupResult {
  const lines = stdout.split('\n').map((line) => line.trim());
  if (lines.includes(CHANGED)) {
    return {
      ok: false,
      code: 'settings_changed',
      message: "Claude's settings on this host changed while HerdrChat was reading them. Nothing was written; try again.",
    };
  }
  if (exitCode !== 0) return commandFailed('write', exitCode, stderr);
  if (!lines.includes(DONE)) return unexpected;
  return { ok: true };
}

/** A script that exited badly, with the first line it wrote to stderr, which is usually the reason ("Permission denied"). */
function commandFailed(verb: 'read' | 'write', exitCode: number, stderr: string): UsageSetupResult {
  const reason = stderr.trim().split('\n')[0]?.trim() ?? '';
  return {
    ok: false,
    code: 'command_failed',
    message: `HerdrChat couldn't ${verb} Claude's settings on this host${reason === '' ? ` (exit ${exitCode})` : `: ${reason}`}.`,
  };
}

async function run(transport: HerdrTransport, plan: (files: StatusLineFiles) => Plan): Promise<UsageSetupResult> {
  try {
    const read = await transport.exec(statusLineReadCommand(), SEND_TIMEOUT_MS);
    if (!read.ok) return { ok: false, code: read.code, message: read.message };
    if (read.exitCode !== 0) return commandFailed('read', read.exitCode, read.stderr);
    const files = parseStatusLineRead(read.stdout);
    if (files === null) return unexpected;
    const planned = plan(files);
    if (!planned.ok) return planned;
    const written = await transport.exec(statusLineWriteCommand(planned.write), SEND_TIMEOUT_MS);
    if (!written.ok) return { ok: false, code: written.code, message: written.message };
    return parseWriteResult(written.stdout, written.exitCode, written.stderr);
  } catch (thrown) {
    return { ok: false, code: 'transport_failed', message: thrown instanceof Error ? thrown.message : String(thrown) };
  }
}

/** Make the wrapper Claude Code's status line on the host. Running it again is harmless. */
export function installUsageStatusLine(transport: HerdrTransport): Promise<UsageSetupResult> {
  return run(transport, installPlan);
}

/** Put the person's status line back and remove what the install wrote. */
export function removeUsageStatusLine(transport: HerdrTransport): Promise<UsageSetupResult> {
  return run(transport, removePlan);
}
