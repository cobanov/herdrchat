import { CODEX_LAUNCHER_SCRIPT } from './codexLauncherScript';
import { HerdrError } from './protocol';
import { shellQuote, withPath } from './shell';
import { LAUNCH_TIMEOUT_MS } from './timeouts';
import type { HerdrTransport } from './transport';

/** Adds a pane-aware PATH shim, leaving the original Codex and shell profiles intact. */
export async function installCodexLauncher(transport: HerdrTransport): Promise<void> {
  const command = 'codex_launcher_dir="$HOME/.local/bin"; ' +
    'for codex_launcher_name in herdrchat-codex codex; do ' +
    'codex_launcher_target="$codex_launcher_dir/$codex_launcher_name"; ' +
    'if [ -e "$codex_launcher_target" ] || [ -L "$codex_launcher_target" ]; then ' +
    'grep -Fqx "# herdrchat-managed-codex-launcher-v1" "$codex_launcher_target" || exit 47; fi; done; ' +
    'mkdir -p "$codex_launcher_dir" || exit $?; ' +
    'for codex_launcher_name in herdrchat-codex codex; do ' +
    'codex_launcher_target="$codex_launcher_dir/$codex_launcher_name"; ' +
    'codex_launcher_tmp=$(mktemp "$codex_launcher_dir/.herdrchat-codex.XXXXXX") || exit $?; ' +
    'trap \'rm -f "$codex_launcher_tmp"\' EXIT HUP INT TERM; ' +
    `printf %s ${shellQuote(CODEX_LAUNCHER_SCRIPT)} > "$codex_launcher_tmp" && ` +
    'chmod 700 "$codex_launcher_tmp" && mv -f "$codex_launcher_tmp" "$codex_launcher_target" || exit $?; done';
  const result = await transport.exec(withPath(command), LAUNCH_TIMEOUT_MS);
  if (!result.ok) throw new HerdrError(result.code, result.message, { transport: true });
  if (result.exitCode === 47) throw new HerdrError('codex_launcher_conflict',
    'A different codex or herdrchat-codex file already exists in ~/.local/bin. Neither was overwritten.');
  if (result.exitCode !== 0) throw new HerdrError('codex_launcher_install_failed',
    `Could not install the Codex launcher (exit ${result.exitCode}). Check write access to ~/.local/bin.`);
}
