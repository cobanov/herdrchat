import { CODEX_LAUNCHER_SCRIPT } from './codexLauncherScript';
import { HerdrError } from './protocol';
import { shellQuote, withPath } from './shell';
import { LAUNCH_TIMEOUT_MS } from './timeouts';
import type { HerdrTransport } from './transport';

/** Installs only our named helper. Never replaces codex or edits shell profiles. */
export async function installCodexLauncher(transport: HerdrTransport): Promise<void> {
  const command = 'codex_launcher_dir="$HOME/.local/bin"; ' +
    'codex_launcher_target="$codex_launcher_dir/herdrchat-codex"; ' +
    'if [ -e "$codex_launcher_target" ] || [ -L "$codex_launcher_target" ]; then ' +
    'grep -Fqx "# herdrchat-managed-codex-launcher-v1" "$codex_launcher_target" || exit 47; fi; ' +
    'mkdir -p "$codex_launcher_dir" || exit $?; ' +
    'codex_launcher_tmp=$(mktemp "$codex_launcher_dir/.herdrchat-codex.XXXXXX") || exit $?; ' +
    'trap \'rm -f "$codex_launcher_tmp"\' EXIT HUP INT TERM; ' +
    `printf %s ${shellQuote(CODEX_LAUNCHER_SCRIPT)} > "$codex_launcher_tmp" && ` +
    'chmod 700 "$codex_launcher_tmp" && mv -f "$codex_launcher_tmp" "$codex_launcher_target"';
  const result = await transport.exec(withPath(command), LAUNCH_TIMEOUT_MS);
  if (!result.ok) throw new HerdrError(result.code, result.message);
  if (result.exitCode === 47) throw new HerdrError('codex_launcher_conflict',
    'A different herdrchat-codex file already exists on this host. It was not overwritten.');
  if (result.exitCode !== 0) throw new HerdrError('codex_launcher_install_failed',
    `Could not install the Codex launcher (exit ${result.exitCode}). Check write access to ~/.local/bin.`);
}
