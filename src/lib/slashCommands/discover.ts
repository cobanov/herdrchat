/**
 * Reading the slash-command catalogue off a host: one `sh` script, and the
 * sentinels its output is framed by (parsed in `parse.ts`).
 *
 * This was built once before and reverted (b704ec8): the scan ran on every
 * thread open, walked `~/.claude/plugins -maxdepth 6`, and since the client
 * serialises commands, everything queued behind it timed out. So the script is
 * bounded in every direction, and when it runs is the caller's business (the
 * chat list's poll, every ten minutes at most; see `client.ts`):
 *
 * - `find` only under fixed directories, `-maxdepth 3` at most, never a walk of
 *   `~/.claude/plugins` itself: each installed plugin is reached through
 *   `installed_plugins.json`, and only its `commands/` and `skills/` are read.
 * - At most `MAX_FILES_PER_DIR` files per directory, `EXCERPT_BYTES` of each,
 *   and only up to the end of its frontmatter.
 * - The Claude binary is grepped only when its path, size or mtime changed
 *   since the last read (`knownBinary`), so the grep over a large bundle runs
 *   once per Claude Code version. Each grep has a deadline the host enforces
 *   by itself (`hs_bounded`: `timeout(1)`, else Perl's `alarm`, else a
 *   watchdog), well inside the exec's own, because a native deadline resets the
 *   whole SSH client and every live tail with it. A grep that hit its deadline
 *   says so (`SLASH_BUILTINS_FAILED`), so a partial read is never taken for a
 *   whole one and cached against the binary.
 * - The whole output is cut at `MAX_OUTPUT_BYTES`; the parser keeps every
 *   record that arrived whole.
 *
 * The shell stays dumb: it prints file names and raw excerpts, and TypeScript
 * does the rest, so there is one parser to test and nothing GNU-only (no
 * `find -printf`, no `grep -P`). Portable across `sh` and `zsh`: no globs (an
 * unmatched one aborts zsh), no unquoted expansions that rely on splitting.
 */
import { shellQuote, withPath } from '../herdr/shell';
import { SLASH_SCAN_GREP_TIMEOUT_S } from '../herdr/timeouts';

export const SLASH_BEGIN = 'HERDRCHAT_SLASH_BEGIN';
export const SLASH_END = 'HERDRCHAT_SLASH_END';
/** `\t<path>\t<size>,<mtime>`: the `claude` on PATH, and what it was when read. */
export const SLASH_BINARY = 'HERDRCHAT_SLASH_BINARY';
/** No `claude` on PATH (or only an alias): the built-ins come from the static list. */
export const SLASH_NO_BINARY = 'HERDRCHAT_SLASH_NO_BINARY';
/** The binary is the one the phone already read; its built-ins are not sent again. */
export const SLASH_BUILTINS_UNCHANGED = 'HERDRCHAT_SLASH_BUILTINS_UNCHANGED';
/** The lines between this and `SLASH_BUILTINS_END` are command literals out of the binary. */
export const SLASH_BUILTINS = 'HERDRCHAT_SLASH_BUILTINS';
export const SLASH_BUILTINS_END = 'HERDRCHAT_SLASH_BUILTINS_END';
/**
 * The grep over the binary failed or hit its deadline: nothing was read. The
 * phone keeps the built-ins it holds and does not record the binary, so the
 * next due scan tries again.
 */
export const SLASH_BUILTINS_FAILED = 'HERDRCHAT_SLASH_BUILTINS_FAILED';
/** `\t<name>\t<installPath>`: an installed plugin. The name may be empty. */
export const SLASH_PLUGIN = 'HERDRCHAT_SLASH_PLUGIN';
/** `\t<kind>\t<source>\t<owner>\t<name>\t<path>`, then the excerpt, then `SLASH_FILE_END`. */
export const SLASH_FILE = 'HERDRCHAT_SLASH_FILE';
export const SLASH_FILE_END = 'HERDRCHAT_SLASH_FILE_END';

/** How much of one command or skill file is read: its frontmatter, in practice. */
export const EXCERPT_BYTES = 4096;
/** Lines of one excerpt, after the byte cut. */
export const EXCERPT_LINES = 80;
/** Files read from one commands or skills directory. */
export const MAX_FILES_PER_DIR = 200;
/** Plugins read from `installed_plugins.json`. */
export const MAX_PLUGINS = 50;
/** Bytes of `installed_plugins.json` and of a plugin's `plugin.json` that are looked at. */
export const PLUGIN_JSON_BYTES = 262_144;
/** Command literals kept from the binary, and the bytes of each. */
export const MAX_BUILTIN_LINES = 600;
export const BUILTIN_LINE_BYTES = 1024;
/** Identifiers a literal may name itself by (`zs({name:M7t,…})`), resolved through the bundle's name table. */
export const MAX_NAME_IDENTIFIERS = 100;
/** The whole answer. Far above a real host's; a cap so no layout can flood the channel. */
export const MAX_OUTPUT_BYTES = 2_097_152;

/**
 * One command literal in the Claude bundle: an object that starts with one of
 * the keys a command literal starts with, or a call `({name:…,` (how bundled
 * skills are registered), then its keys, strings and up to two levels of
 * nested braces, so a getter like `get description(){return\`…${x}…\`}` is
 * kept whole. It ends at the literal's own `}`.
 *
 * Verified on Claude Code 2.1.296: the shape `type:"local",name:"…",
 * description:"…"` alone misses the commands whose keys come in another order
 * (`{name:"context",…,type:"local-jsx"}`) and those with a computed description;
 * and a call that names itself only by a string misses the bundled skills
 * registered by a variable (`zs({name:M7t,…})`, `M7t="simplify"`: `/simplify`,
 * `/loop`, `/code-review`, `/schedule`, `/commit`, `/pr`, `/verify`).
 * ERE only, and no bound above 255 (BSD grep's limit).
 */
export const BUILTIN_PATTERN =
  '(\\{(type|name|description|aliases):|\\(\\{name:("[a-z0-9-]+"|[A-Za-z_$][A-Za-z0-9_$]*),)([^"{}]|"[^"]*"|\\{([^{}]|\\{[^{}]*\\})*\\})*';
/** A literal is kept only when it names itself, by a string or by a variable… */
export const BUILTIN_NAME_FILTER = 'name:("[a-z0-9-]+"|[A-Za-z_$][A-Za-z0-9_$]*[,}])';
/**
 * …and is a command (`type`) or a bundled skill: one that builds its prompt
 * (`getPromptForCommand`) or, when its literal is cut before that (deep braces
 * in an earlier method, as `/code-review`'s `getDefaultEffort`), one with the
 * keys only a skill's registration has.
 */
export const BUILTIN_KIND_FILTER = 'type:"(local|local-jsx|prompt)"|getPrompt|menuDescription:|userInvocable:';
/**
 * The bundle's name table, grepped beside the literals: a short top-level
 * variable set to a command-like string (`,M7t="simplify"`). Only the entries
 * for identifiers a kept literal names itself by are sent; an identifier set to
 * two different names is left unresolved by the parser.
 */
export const BUILTIN_NAME_TABLE_PATTERN = '[, ][A-Za-z_$][A-Za-z0-9_$]{1,3}="[a-z][a-z0-9-]{1,30}"';

export interface ScanRequest {
  /** Read the host-wide part: the binary's built-ins, the person's commands and skills, plugins. */
  host: boolean;
  /** Project folders whose `.claude/commands` and `.claude/skills` to read. */
  cwds: readonly string[];
  /**
   * `<path> <size>,<mtime>` of the binary whose built-ins the phone holds
   * (`binaryKey`), or null. When the host's binary still matches, the grep is
   * skipped and the answer says so.
   */
  knownBinary: string | null;
  /** The greps' deadline in seconds; `SLASH_SCAN_GREP_TIMEOUT_S` unless a test needs a short one. */
  grepDeadlineS?: number;
}

/** How a binary is named in `knownBinary`: what the script compares against. */
export function binaryKey(path: string, signature: string): string {
  return `${path} ${signature}`;
}

/** The functions the script calls. Defined once, called per directory. */
const FUNCTIONS = [
  // `hs_bounded <seconds> <command…>`: the command, stopped by the host itself
  // at the deadline. `timeout(1)` where there is one (not on stock macOS), else
  // Perl's `alarm`, which survives the `exec`, else a watchdog. A stopped
  // command's status is above 1 (124, 142, 143), which grep never returns for
  // an answer, so the caller can tell a cut read from a whole one.
  'hs_bounded() {',
  '  hs_secs=$1; shift',
  '  if command -v timeout >/dev/null 2>&1; then timeout "$hs_secs" "$@"; return $?; fi',
  `  if command -v perl >/dev/null 2>&1; then perl -e 'alarm shift @ARGV; exec @ARGV or exit 127' "$hs_secs" "$@"; return $?; fi`,
  '  "$@" &',
  '  hs_pid=$!',
  // Its output to /dev/null: a `sleep` left behind must not hold the channel open.
  '  ( sleep "$hs_secs"; kill "$hs_pid" ) >/dev/null 2>&1 &',
  '  hs_dog=$!',
  '  wait "$hs_pid"; hs_rc=$?',
  '  kill "$hs_dog" 2>/dev/null',
  '  return $hs_rc',
  '}',
  // A file's record line, then its excerpt: up to the frontmatter's closing
  // `---` (or the first such line, for a file without frontmatter, whose
  // description is its first line anyway).
  'hs_emit() {',
  `  printf '${SLASH_FILE}\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$1" "$2" "$3" "$4" "$5"`,
  `  head -c ${EXCERPT_BYTES} "$5" 2>/dev/null | sed -n '1,/^---[[:space:]]*$/p' | head -n ${EXCERPT_LINES}`,
  `  printf '\\n${SLASH_FILE_END}\\n'`,
  '}',
  // `<dir>/**/*.md`, three levels deep: `foo/bar.md` is `/foo:bar`.
  'hs_commands() {',
  '  [ -d "$1" ] || return 0',
  `  find -L "$1" -maxdepth 3 -type f -name '*.md' 2>/dev/null | head -n ${MAX_FILES_PER_DIR} | while IFS= read -r hs_f; do`,
  '    hs_emit command "$2" "$3" "${hs_f#"$1"/}" "$hs_f"',
  '  done',
  '}',
  // `<dir>/*/SKILL.md`: the skill is its directory's name.
  'hs_skills() {',
  '  [ -d "$1" ] || return 0',
  `  find -L "$1" -maxdepth 2 -type f -name SKILL.md 2>/dev/null | head -n ${MAX_FILES_PER_DIR} | while IFS= read -r hs_f; do`,
  '    hs_d=${hs_f%/SKILL.md}',
  '    [ "$hs_d" = "$1" ] && continue',
  '    hs_emit skill "$2" "$3" "${hs_d##*/}" "$hs_f"',
  '  done',
  '}',
  // The built-ins, out of the `claude` this host runs, unless unchanged.
  'hs_builtins() {',
  '  hs_b=$(command -v claude 2>/dev/null)',
  // An alias or a function is not a file to read.
  '  case "$hs_b" in /*) ;; *) hs_b= ;; esac',
  `  if [ -z "$hs_b" ] || [ ! -f "$hs_b" ]; then echo ${SLASH_NO_BINARY}; return 0; fi`,
  '  hs_s=$(stat -L -c %s,%Y "$hs_b" 2>/dev/null || stat -L -f %z,%m "$hs_b" 2>/dev/null)',
  `  printf '${SLASH_BINARY}\\t%s\\t%s\\n' "$hs_b" "$hs_s"`,
  `  if [ "$hs_b $hs_s" = "$1" ]; then echo ${SLASH_BUILTINS_UNCHANGED}; return 0; fi`,
  `  hs_re=${shellQuote(BUILTIN_PATTERN)}`,
  `  hs_nt=${shellQuote(BUILTIN_NAME_TABLE_PATTERN)}`,
  '  hs_t=$(mktemp 2>/dev/null) || hs_t=',
  '  hs_u=$(mktemp 2>/dev/null) || hs_u=',
  `  if [ -z "$hs_t" ] || [ -z "$hs_u" ]; then rm -f "$hs_t" "$hs_u"; echo ${SLASH_BUILTINS_FAILED}; return 0; fi`,
  // The literals and the name table, side by side: two cores, one wait.
  `  hs_bounded "$2" grep -a -o -E "$hs_re" "$hs_b" >"$hs_t" 2>/dev/null &`,
  '  hs_p1=$!',
  `  hs_bounded "$2" grep -a -o -E "$hs_nt" "$hs_b" >"$hs_u" 2>/dev/null &`,
  '  hs_p2=$!',
  '  wait "$hs_p1"; hs_r1=$?',
  '  wait "$hs_p2"; hs_r2=$?',
  // 0 is a match, 1 is none; anything else is an error or the deadline.
  '  if [ "$hs_r1" -gt 1 ] || [ "$hs_r2" -gt 1 ]; then',
  `    rm -f "$hs_t" "$hs_u"; echo ${SLASH_BUILTINS_FAILED}; return 0`,
  '  fi',
  `  hs_l=$(tr -d '\\000' <"$hs_t" | grep -a -E ${shellQuote(BUILTIN_NAME_FILTER)} | grep -a -E ${shellQuote(BUILTIN_KIND_FILTER)} | cut -c 1-${BUILTIN_LINE_BYTES} | head -n ${MAX_BUILTIN_LINES})`,
  `  echo ${SLASH_BUILTINS}`,
  '  [ -n "$hs_l" ] && printf \'%s\\n\' "$hs_l"',
  // The name-table entries for the identifiers the kept literals name themselves by.
  `  printf '%s\\n' "$hs_l" | grep -a -o -E '\\(\\{name:[A-Za-z_$][A-Za-z0-9_$]*,' | sed -e 's/^({name://' -e 's/,$//' | sort -u | head -n ${MAX_NAME_IDENTIFIERS} |`,
  `    awk 'NR == FNR { want[$0] = 1; next } { s = substr($0, 2); i = index(s, "="); if (substr(s, 1, i - 1) in want) print "," s }' - "$hs_u" | sort -u | head -n ${MAX_NAME_IDENTIFIERS * 4}`,
  '  rm -f "$hs_t" "$hs_u"',
  `  echo ${SLASH_BUILTINS_END}`,
  '}',
  // The person's own commands and skills.
  'hs_user() {',
  '  hs_commands "$hs_c/commands" user -',
  '  hs_skills "$hs_c/skills" user -',
  '}',
  // Each installed plugin's commands and skills, by its install path only.
  'hs_plugins() {',
  '  hs_j="$hs_c/plugins/installed_plugins.json"',
  '  [ -f "$hs_j" ] || return 0',
  `  head -c ${PLUGIN_JSON_BYTES} "$hs_j" | grep -o '"installPath"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/^"installPath"[[:space:]]*:[[:space:]]*"//; s/"$//' | head -n ${MAX_PLUGINS} | while IFS= read -r hs_p; do`,
  '    [ -d "$hs_p" ] || continue',
  `    hs_n=$(head -c ${PLUGIN_JSON_BYTES} "$hs_p/.claude-plugin/plugin.json" 2>/dev/null | grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | sed 's/^"name"[[:space:]]*:[[:space:]]*"//; s/"$//')`,
  `    printf '${SLASH_PLUGIN}\\t%s\\t%s\\n' "$hs_n" "$hs_p"`,
  '    hs_commands "$hs_p/commands" plugin "$hs_p"',
  '    hs_skills "$hs_p/skills" plugin "$hs_p"',
  '  done',
  '}',
  // One project folder's commands and skills.
  'hs_project() {',
  '  hs_commands "$1/.claude/commands" project "$1"',
  '  hs_skills "$1/.claude/skills" project "$1"',
  '}',
];

/** The script itself, before it is wrapped for `sh -c`. Exposed for tests. */
export function discoveryScript(request: ScanRequest): string {
  const calls: string[] = [];
  if (request.host) {
    const deadline = Math.max(1, Math.round(request.grepDeadlineS ?? SLASH_SCAN_GREP_TIMEOUT_S));
    calls.push(`hs_builtins ${shellQuote(request.knownBinary ?? '')} ${deadline}`, 'hs_user', 'hs_plugins');
  }
  for (const cwd of request.cwds) calls.push(`hs_project ${shellQuote(cwd)}`);
  return [
    // Bytes, not characters: the binary is not text, and `cut -c` must count bytes.
    'LC_ALL=C; export LC_ALL',
    'hs_c="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"',
    ...FUNCTIONS,
    `{ echo ${SLASH_BEGIN}`,
    ...calls.map((call) => `  ${call}`),
    `} | head -c ${MAX_OUTPUT_BYTES}`,
    // Outside the cut, so a cut answer still ends where the parser expects.
    `printf '\\n${SLASH_END}\\n'`,
  ].join('\n');
}

/** The command the transport runs. */
export function discoveryCommand(request: ScanRequest): string {
  return withPath(`sh -c ${shellQuote(discoveryScript(request))}`);
}
