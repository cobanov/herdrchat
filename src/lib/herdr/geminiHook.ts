import { HerdrError, transportError } from './protocol';
import { shellQuote, withPath } from './shell';
import { LAUNCH_TIMEOUT_MS } from './timeouts';
import type { HerdrTransport } from './transport';

/**
 * herdr has no integration for Gemini CLI, so nothing tells it which log a
 * Gemini pane is writing, and the app never guesses one. Gemini CLI runs user
 * hooks from `~/.gemini/settings.json` (0.64, in folders it trusts), each
 * given the session as JSON on stdin with `transcript_path` in it. This hook,
 * run at SessionStart and before every prompt (BeforeAgent: a resume or a
 * quota rotation changes the file mid-session), reports that exact path to
 * herdr as the pane's session. Gemini reads a hook's stdout as its answer, so
 * it prints nothing, and it never fails Gemini: every path ends in exit 0.
 */
export const GEMINI_HOOK_SCRIPT = [
  '#!/bin/sh',
  '# herdrchat-managed-gemini-session-hook-v1',
  "# Installed by HerdrChat. Tells herdr which log is this pane's Gemini CLI",
  '# conversation, so HerdrChat can read it. Prints nothing; always exits 0.',
  '[ "${HERDR_ENV:-}" = 1 ] && [ -n "${HERDR_PANE_ID:-}" ] || exit 0',
  'command -v python3 >/dev/null 2>&1 || exit 0',
  "python3 -c '",
  'import json, os, subprocess, sys, time',
  'try:',
  '    event = json.load(sys.stdin)',
  '    path = event.get("transcript_path")',
  '    if isinstance(path, str) and path.endswith(".jsonl"):',
  '        argv = [os.environ.get("HERDR_BIN_PATH") or "herdr", "pane", "report-agent-session",',
  '                os.environ["HERDR_PANE_ID"], "--source", "herdrchat:gemini", "--agent", "gemini",',
  '                "--seq", str(time.time_ns()), "--agent-session-path", path]',
  '        if event.get("source") in ("startup", "resume", "clear"):',
  '            argv += ["--session-start-source", event["source"]]',
  '        subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,',
  '                       stderr=subprocess.DEVNULL, timeout=1)',
  'except Exception:',
  '    pass',
  "' >/dev/null 2>&1",
  'exit 0',
  '',
].join('\n');

/** The hook's name in Gemini's settings: how a reinstall finds its own entries, and `/hooks disable` names it. */
export const GEMINI_HOOK_NAME = 'herdrchat-session';

/**
 * Merges the hook into Gemini's settings: every other key and hook is kept,
 * an earlier copy of ours is replaced, and the file as it was is kept once as
 * `settings.json.herdrchat-bak`. A file that is not plain JSON (Gemini also
 * takes comments) is left alone: exit 48. A symlinked settings file is
 * written through, not replaced.
 */
const MERGE_SETTINGS = `
import json, os, shlex, shutil, sys
# Quoted: Gemini runs a command hook with bash -c, and a home folder can have a space.
path, command, name = os.path.realpath(sys.argv[1]), shlex.quote(sys.argv[2]), sys.argv[3]
try:
    with open(path, encoding="utf-8") as file:
        text = file.read()
except FileNotFoundError:
    text = ""
try:
    settings = json.loads(text) if text.strip() else {}
except ValueError:
    sys.exit(48)
hooks = settings.setdefault("hooks", {}) if isinstance(settings, dict) else None
if not isinstance(hooks, dict):
    sys.exit(48)
ours = {"name": name, "type": "command", "command": command, "timeout": 2000}
for event in ("SessionStart", "BeforeAgent"):
    groups = hooks.get(event, [])
    if not isinstance(groups, list):
        sys.exit(48)
    kept = []
    for group in groups:
        entries = group.get("hooks") if isinstance(group, dict) else None
        if isinstance(entries, list):
            others = [entry for entry in entries if not (isinstance(entry, dict) and entry.get("name") == name)]
            if not others and len(others) != len(entries):
                continue
            group["hooks"] = others
        kept.append(group)
    hooks[event] = kept + [{"hooks": [ours]}]
if text and not os.path.exists(path + ".herdrchat-bak"):
    shutil.copy2(path, path + ".herdrchat-bak")
temporary = path + ".herdrchat-tmp"
# Private until it takes the original's mode: settings can hold secrets.
with open(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as file:
    json.dump(settings, file, indent=2)
    file.write("\\n")
if text:
    shutil.copymode(path, temporary)
os.replace(temporary, path)
`;

/**
 * Installs the hook script in `~/.local/share/herdrchat` and adds it to
 * Gemini CLI's user settings, for SessionStart and BeforeAgent. Safe to run
 * again. Gemini reads its hooks when it starts, so one already running reports
 * nothing until it is started again.
 */
export async function installGeminiHook(transport: HerdrTransport): Promise<void> {
  const command = 'gemini_hook="$HOME/.local/share/herdrchat/gemini-session-hook.sh"; ' +
    'gemini_settings="${GEMINI_CLI_HOME:-$HOME}/.gemini/settings.json"; ' +
    'command -v python3 >/dev/null 2>&1 || exit 49; ' +
    'mkdir -p "${gemini_hook%/*}" "${gemini_settings%/*}" || exit $?; ' +
    'gemini_tmp=$(mktemp "$gemini_hook.XXXXXX") || exit $?; ' +
    'trap \'rm -f "$gemini_tmp"\' EXIT HUP INT TERM; ' +
    `printf %s ${shellQuote(GEMINI_HOOK_SCRIPT)} > "$gemini_tmp" && ` +
    'chmod 755 "$gemini_tmp" && mv -f "$gemini_tmp" "$gemini_hook" || exit $?; ' +
    `python3 -c ${shellQuote(MERGE_SETTINGS)} "$gemini_settings" "$gemini_hook" ${shellQuote(GEMINI_HOOK_NAME)}`;
  const result = await transport.exec(withPath(command), LAUNCH_TIMEOUT_MS);
  if (!result.ok) throw transportError(result);
  if (result.exitCode === 48) throw new HerdrError('gemini_settings_invalid',
    "~/.gemini/settings.json isn't plain JSON (comments, or a value that isn't an object), so it was left as it is. " +
    `Add a "${GEMINI_HOOK_NAME}" command hook running ~/.local/share/herdrchat/gemini-session-hook.sh ` +
    'to SessionStart and BeforeAgent by hand.');
  if (result.exitCode === 49) throw new HerdrError('gemini_hook_install_failed',
    'The Gemini hook needs python3 on the host, and none was found.');
  if (result.exitCode !== 0) throw new HerdrError('gemini_hook_install_failed',
    `Could not install the Gemini hook (exit ${result.exitCode}). Check write access to ~/.local/share and ~/.gemini.`);
}
