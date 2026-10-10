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
 *   once per Claude Code version, and under `timeout(1)` where the host has it.
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
/** The whole answer. Far above a real host's; a cap so no layout can flood the channel. */
export const MAX_OUTPUT_BYTES = 2_097_152;

/**
 * One command literal in the Claude bundle: an object that starts with one of
 * the keys a command literal starts with, or a call `({name:"…"` (how bundled
 * skills are registered), then its keys, strings and up to two levels of
 * nested braces, so a getter like `get description(){return\`…${x}…\`}` is
 * kept whole. It ends at the literal's own `}`.
 *
 * Verified on Claude Code 2.1.296: the shape `type:"local",name:"…",
 * description:"…"` alone misses the commands whose keys come in another order
 * (`{name:"context",…,type:"local-jsx"}`) and those with a computed description.
 * ERE only, and no bound above 255 (BSD grep's limit).
 */
export const BUILTIN_PATTERN =
  '(\\{(type|name|description|aliases):|\\(\\{name:"[a-z0-9-]+",)([^"{}]|"[^"]*"|\\{([^{}]|\\{[^{}]*\\})*\\})*';
/** A literal is kept only when it names itself… */
export const BUILTIN_NAME_FILTER = 'name:"[a-z0-9-]+"';
/** …and is a command (`type`) or a bundled skill (`getPromptForCommand`). */
export const BUILTIN_KIND_FILTER = 'type:"(local|local-jsx|prompt)"|getPrompt';

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
}

/** How a binary is named in `knownBinary`: what the script compares against. */
export function binaryKey(path: string, signature: string): string {
  return `${path} ${signature}`;
}

/** The functions the script calls. Defined once, called per directory. */
const FUNCTIONS = [
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
  `  echo ${SLASH_BUILTINS}`,
  '  if command -v timeout >/dev/null 2>&1; then',
  `    timeout ${SLASH_SCAN_GREP_TIMEOUT_S} grep -a -o -E "$hs_re" "$hs_b"`,
  '  else',
  '    grep -a -o -E "$hs_re" "$hs_b"',
  `  fi | grep -a -E ${shellQuote(BUILTIN_NAME_FILTER)} | grep -a -E ${shellQuote(BUILTIN_KIND_FILTER)} | cut -c 1-${BUILTIN_LINE_BYTES} | head -n ${MAX_BUILTIN_LINES}`,
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
    calls.push(`hs_builtins ${shellQuote(request.knownBinary ?? '')}`, 'hs_user', 'hs_plugins');
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
