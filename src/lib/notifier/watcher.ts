import { commandWord, shellQuote } from '../herdr/shell';
import { WATCHER_SCRIPT_BASE64, WATCHER_VERSION } from './watcherScript';

/**
 * The notification watcher, installed on a host by the app.
 *
 * Notifications need a small process on the host that notices an agent
 * blocking or finishing. Asking an App Store user to copy a Python script onto
 * their machine and write a LaunchAgent for it meant, in practice, that nobody
 * had notifications. The app already has a shell on the host, so it installs
 * the watcher itself, as a service that survives a reboot:
 *
 * - macOS: a LaunchAgent (`~/Library/LaunchAgents/<label>.plist`), bootstrapped
 *   into the GUI domain, or the user domain when nobody is logged in there.
 * - Linux with a systemd user instance: a user unit, with lingering asked for so
 *   it keeps running after the SSH session ends.
 * - Anything else: a background process with a pid file, which lasts until the
 *   host restarts. The status says so.
 *
 * One watcher per herdr session, because a watcher reads one session's agents
 * and pushes to that session's phones (see `push.ts`). The session comes from
 * `HERDR_SESSION`, which `withSession` exports only for a named session.
 *
 * Nothing here runs `exit`: the transport appends a completion mark, and a
 * command that exits early is indistinguishable from one killed on the way.
 */

export { WATCHER_VERSION };

export type WatcherState =
  /** Installed by the app and running. `version` is what the host has. */
  | { kind: 'running'; version: number | null; service: ServiceKind; lingering: boolean | null }
  /** Installed but not running: stopped, crashed, or the host restarted. */
  | { kind: 'stopped'; version: number | null; service: ServiceKind }
  | { kind: 'missing'; manual: boolean }
  /** The watcher is Python; without python3 it cannot run here. */
  | { kind: 'no_python' };

export type ServiceKind = 'launchd' | 'systemd' | 'process';

/** Whether a host's watcher should be replaced with the one this app carries. */
export function isOutdated(state: WatcherState): boolean {
  return (state.kind === 'running' || state.kind === 'stopped') && (state.version ?? 0) < WATCHER_VERSION;
}

/** Shared by both commands: names, paths, and whether python3 is usable. */
const PRELUDE = [
  'label="dev.herdr.herdrchat-notifier${HERDR_SESSION:+.$HERDR_SESSION}"',
  'uid=$(id -u)',
  'dir="$HOME/.local/share/herdrchat"',
  'file="$dir/herdr-notifier.py"',
  'state="$HOME/.local/state/herdrchat"',
  'py=$(command -v python3 2>/dev/null)',
  // Apple's /usr/bin/python3 is a stub that opens an install dialog on the
  // host's screen when the developer tools are missing. Same rule as the socket
  // probe in socket.ts.
  'if [ -n "$py" ] && [ "$(uname)" = Darwin ] && [ "$py" = /usr/bin/python3 ] && ! xcode-select -p >/dev/null 2>&1; then py=; fi',
].join('\n');

/**
 * What is installed and whether it runs, in one round-trip. Prints `KEY value`
 * lines; `parseWatcherStatus` reads them.
 */
export function watcherStatusCommand(): string {
  return [
    PRELUDE,
    'kind=none; run=no',
    'if [ "$(uname)" = Darwin ]; then',
    '  for dom in gui user; do',
    '    if out=$(launchctl print "$dom/$uid/$label" 2>/dev/null); then',
    '      kind=launchd; case "$out" in *"state = running"*) run=yes;; esac; break',
    '    fi',
    '  done',
    'elif command -v systemctl >/dev/null 2>&1 && systemctl --user cat "$label.service" >/dev/null 2>&1; then',
    '  kind=systemd; systemctl --user is-active --quiet "$label.service" && run=yes',
    'fi',
    'if [ "$kind" = none ] && [ -f "$state/$label.pid" ]; then',
    '  kind=process; kill -0 "$(cat "$state/$label.pid")" 2>/dev/null && run=yes',
    'fi',
    'echo "PYTHON ${py:+yes}"',
    'echo "SERVICE $kind"',
    'echo "RUNNING $run"',
    'if [ -f "$file" ]; then echo "VERSION $(sed -n \'s/^WATCHER_VERSION = //p\' "$file" | head -n 1)"; fi',
    // A watcher someone started by hand from the repository. The brackets keep
    // the pattern from matching this very command line.
    'if pgrep -f "[h]erdr-apns-notifier.py" >/dev/null 2>&1; then echo "MANUAL yes"; fi',
    // systemd's lingering, so asked only where systemd is.
    'if [ "$(uname)" != Darwin ] && command -v loginctl >/dev/null 2>&1; then echo "LINGER $(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)"; fi',
    'true',
  ].join('\n');
}

export function parseWatcherStatus(stdout: string): WatcherState {
  const fields = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const space = line.indexOf(' ');
    if (space > 0) fields.set(line.slice(0, space), line.slice(space + 1).trim());
    else if (line.trim().length > 0) fields.set(line.trim(), '');
  }
  const service = fields.get('SERVICE');
  const versionText = fields.get('VERSION');
  const version = versionText !== undefined && /^\d+$/.test(versionText) ? Number(versionText) : null;
  const kind: ServiceKind | null =
    service === 'launchd' || service === 'systemd' || service === 'process' ? service : null;

  if (kind !== null && fields.get('RUNNING') === 'yes') {
    const linger = fields.get('LINGER');
    return { kind: 'running', version, service: kind, lingering: linger === undefined ? null : linger === 'yes' };
  }
  if (fields.get('PYTHON') !== 'yes') return { kind: 'no_python' };
  if (kind !== null) return { kind: 'stopped', version, service: kind };
  return { kind: 'missing', manual: fields.get('MANUAL') === 'yes' };
}

/**
 * Install (or update) the watcher and start it. Ends by printing the same
 * status lines as `watcherStatusCommand`, so one round-trip says what happened.
 *
 * `herdrPath` is the connection's herdr path; the watcher gets it as an
 * absolute path because a service does not inherit the login shell's PATH.
 */
export function watcherInstallCommand(herdrPath: string): string {
  const herdr = commandWord(herdrPath);
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<plist version="1.0"><dict>',
    '<key>Label</key><string>$label</string>',
    '<key>ProgramArguments</key><array><string>$py</string><string>$file</string></array>',
    '<key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATH</string><key>HERDR_BIN</key><string>$hb</string>${HERDR_SESSION:+<key>HERDR_SESSION</key><string>$HERDR_SESSION</string>}</dict>',
    '<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>',
    '<key>StandardOutPath</key><string>$HOME/Library/Logs/$label.log</string>',
    '<key>StandardErrorPath</key><string>$HOME/Library/Logs/$label.log</string>',
    '</dict></plist>',
  ]
    .map((line) => `"${line.replace(/"/g, '\\"')}"`)
    .join(' ');
  const unit = [
    '[Unit]',
    'Description=HerdrChat notifier',
    '[Service]',
    'ExecStart=\\"$py\\" \\"$file\\"',
    'Environment=\\"PATH=$PATH\\"',
    'Environment=\\"HERDR_BIN=$hb\\"',
    '${HERDR_SESSION:+Environment=\\"HERDR_SESSION=$HERDR_SESSION\\"}',
    'Restart=always',
    'RestartSec=5',
    '[Install]',
    'WantedBy=default.target',
  ]
    .map((line) => `"${line}"`)
    .join(' ');

  return [
    PRELUDE,
    'if [ -n "$py" ]; then',
    '  mkdir -p "$dir" "$state"',
    // Written beside the old copy and moved into place, so a running watcher
    // never reads half a file.
    `  "$py" -c 'import base64,sys;open(sys.argv[1],"wb").write(base64.b64decode(sys.argv[2]))' "$file.new" ${shellQuote(WATCHER_SCRIPT_BASE64)} && mv "$file.new" "$file"`,
    `  hb=$(command -v ${herdr} 2>/dev/null); [ -n "$hb" ] || hb=${herdr}`,
    '  if [ "$(uname)" = Darwin ]; then',
    '    agents="$HOME/Library/LaunchAgents"; plist="$agents/$label.plist"',
    '    mkdir -p "$agents" "$HOME/Library/Logs"',
    `    printf '%s\\n' ${plist} > "$plist"`,
    '    launchctl bootout "gui/$uid/$label" >/dev/null 2>&1; launchctl bootout "user/$uid/$label" >/dev/null 2>&1',
    // bootout returns before the job is gone; bootstrap right behind it can
    // fail with an I/O error, so it gets a few tries.
    '    for try in 1 2 3 4 5; do',
    '      launchctl bootstrap "gui/$uid" "$plist" >/dev/null 2>&1 && break',
    '      launchctl bootstrap "user/$uid" "$plist" >/dev/null 2>&1 && break',
    '      sleep 1',
    '    done',
    '  elif command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then',
    '    units="$HOME/.config/systemd/user"; mkdir -p "$units"',
    `    printf '%s\\n' ${unit} > "$units/$label.service"`,
    // Without lingering, a user service stops when the last session ends,
    // which for an SSH-only host is the moment this command returns.
    '    loginctl enable-linger "$(id -un)" >/dev/null 2>&1',
    '    systemctl --user daemon-reload && systemctl --user enable "$label.service" >/dev/null 2>&1',
    '    systemctl --user restart "$label.service"',
    '  else',
    '    if [ -f "$state/$label.pid" ]; then kill "$(cat "$state/$label.pid")" 2>/dev/null; fi',
    '    HERDR_BIN="$hb" nohup "$py" "$file" >"$state/$label.log" 2>&1 </dev/null &',
    '    echo $! > "$state/$label.pid"',
    '  fi',
    '  sleep 1',
    'fi',
    watcherStatusCommand(),
  ].join('\n');
}

/**
 * Stop and remove the app-installed watcher for this session. Token files are
 * left alone: other phones may still be registered, and a watcher reinstalled
 * later picks them up again.
 */
export function watcherRemoveCommand(): string {
  return [
    PRELUDE,
    'if [ "$(uname)" = Darwin ]; then',
    '  launchctl bootout "gui/$uid/$label" >/dev/null 2>&1; launchctl bootout "user/$uid/$label" >/dev/null 2>&1',
    '  rm -f "$HOME/Library/LaunchAgents/$label.plist"',
    'elif command -v systemctl >/dev/null 2>&1 && systemctl --user cat "$label.service" >/dev/null 2>&1; then',
    '  systemctl --user disable --now "$label.service" >/dev/null 2>&1',
    '  rm -f "$HOME/.config/systemd/user/$label.service"; systemctl --user daemon-reload',
    'fi',
    'if [ -f "$state/$label.pid" ]; then kill "$(cat "$state/$label.pid")" 2>/dev/null; rm -f "$state/$label.pid"; fi',
    'true',
  ].join('\n');
}
