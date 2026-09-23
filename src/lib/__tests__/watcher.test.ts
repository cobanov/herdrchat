/**
 * @jest-environment node
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  WATCHER_VERSION,
  isOutdated,
  parseWatcherStatus,
  watcherInstallCommand,
  watcherRemoveCommand,
  watcherStatusCommand,
} from '../notifier/watcher';
import { WATCHER_SCRIPT_BASE64 } from '../notifier/watcherScript';

const SCRIPT = join(__dirname, '..', '..', '..', 'scripts', 'herdr-apns-notifier.py');

// The app installs what it embeds. An edit to the script that was not
// re-embedded would ship the old watcher while the repository shows the new one.
it('embeds the current watcher script', () => {
  const embedded = Buffer.from(WATCHER_SCRIPT_BASE64, 'base64').toString('utf8');
  expect(embedded).toBe(readFileSync(SCRIPT, 'utf8'));
  expect(embedded).toContain(`WATCHER_VERSION = ${WATCHER_VERSION}\n`);
});

describe('status', () => {
  it('reads each state', () => {
    expect(parseWatcherStatus('PYTHON yes\nSERVICE launchd\nRUNNING yes\nVERSION 2\n')).toEqual({
      kind: 'running', version: 2, service: 'launchd', lingering: null,
    });
    expect(parseWatcherStatus('PYTHON yes\nSERVICE systemd\nRUNNING yes\nVERSION 1\nLINGER no\n')).toEqual({
      kind: 'running', version: 1, service: 'systemd', lingering: false,
    });
    expect(parseWatcherStatus('PYTHON yes\nSERVICE process\nRUNNING no\n')).toEqual({
      kind: 'stopped', version: null, service: 'process',
    });
    expect(parseWatcherStatus('PYTHON yes\nSERVICE none\nRUNNING no\nMANUAL yes\n')).toEqual({ kind: 'missing', manual: true });
    expect(parseWatcherStatus('PYTHON \nSERVICE none\nRUNNING no\n')).toEqual({ kind: 'no_python' });
  });

  it('knows an older watcher is worth replacing', () => {
    expect(isOutdated({ kind: 'running', version: WATCHER_VERSION - 1, service: 'launchd', lingering: null })).toBe(true);
    expect(isOutdated({ kind: 'running', version: WATCHER_VERSION, service: 'launchd', lingering: null })).toBe(false);
    expect(isOutdated({ kind: 'missing', manual: false })).toBe(false);
  });
});

/**
 * A throwaway HOME and a bin folder whose stand-ins steer the command down one
 * branch: `uname` says which system this is, `launchctl` and `systemctl`
 * record what they were asked and remember what is loaded, and `python3` runs
 * the real interpreter for the decoding step but only sleeps in place of the
 * watcher itself.
 */
function host(system: 'Darwin' | 'Linux', { systemd = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'hc-watcher-'));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  const realPython = execFileSync('sh', ['-c', 'command -v python3'], { encoding: 'utf8' }).trim();
  const stub = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  stub('uname', `echo ${system}`);
  stub('herdr', 'exit 0');
  stub('python3', `[ "$1" = -c ] && exec ${realPython} "$@"; exec sleep 30`);
  stub('launchctl', [
    'echo "$*" >> "$HOME/launchctl.log"',
    'case "$1" in',
    '  bootstrap) touch "$HOME/.loaded";;',
    '  bootout) rm -f "$HOME/.loaded";;',
    '  print) [ -f "$HOME/.loaded" ] || exit 113; echo "state = running";;',
    'esac',
  ].join('\n'));
  stub('systemctl', systemd
    ? [
        'echo "$*" >> "$HOME/systemctl.log"',
        'case "$2" in',
        '  cat) [ -f "$HOME/.config/systemd/user/$3" ];;',
        '  is-active) [ -f "$HOME/.active" ];;',
        '  restart) touch "$HOME/.active";;',
        'esac',
      ].join('\n')
    : 'exit 1');
  if (system === 'Linux') stub('loginctl', 'case "$1" in show-user) echo yes;; esac');
  const run = (command: string, session?: string) =>
    execFileSync('sh', ['-c', command], {
      encoding: 'utf8',
      env: { NODE_ENV: 'test', HOME: home, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, ...(session === undefined ? {} : { HERDR_SESSION: session }) },
    });
  const cleanup = () => {
    const pid = join(home, '.local/state/herdrchat');
    try {
      execFileSync('sh', ['-c', `for f in "${pid}"/*.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; done; true`]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  };
  return { home, run, cleanup };
}

describe('install', () => {
  it('writes the script and a LaunchAgent on macOS, and reports it running', () => {
    const { home, run, cleanup } = host('Darwin');
    try {
      expect(parseWatcherStatus(run(watcherStatusCommand()))).toEqual({ kind: 'missing', manual: false });
      const state = parseWatcherStatus(run(watcherInstallCommand('herdr')));
      expect(state).toEqual({ kind: 'running', version: WATCHER_VERSION, service: 'launchd', lingering: null });
      expect(readFileSync(join(home, '.local/share/herdrchat/herdr-notifier.py'), 'utf8')).toBe(readFileSync(SCRIPT, 'utf8'));
      const plist = readFileSync(join(home, 'Library/LaunchAgents/dev.herdr.herdrchat-notifier.plist'), 'utf8');
      expect(plist).toContain('<string>dev.herdr.herdrchat-notifier</string>');
      // An absolute herdr: a LaunchAgent does not get the login shell's PATH.
      expect(plist).toContain(`<key>HERDR_BIN</key><string>${home}/bin/herdr</string>`);
      expect(plist).not.toContain('HERDR_SESSION');
      expect(readFileSync(join(home, 'launchctl.log'), 'utf8')).toContain('bootstrap gui/');
    } finally {
      cleanup();
    }
  });

  // One watcher per session, each telling herdr which session to watch.
  it('keeps a named session in its own LaunchAgent', () => {
    const { home, run, cleanup } = host('Darwin');
    try {
      run(watcherInstallCommand('herdr'), 'work');
      const plist = readFileSync(join(home, 'Library/LaunchAgents/dev.herdr.herdrchat-notifier.work.plist'), 'utf8');
      expect(plist).toContain('<key>HERDR_SESSION</key><string>work</string>');
      run(watcherRemoveCommand(), 'work');
      expect(existsSync(join(home, 'Library/LaunchAgents/dev.herdr.herdrchat-notifier.work.plist'))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('uses a systemd user unit on Linux, with lingering', () => {
    const { home, run, cleanup } = host('Linux', { systemd: true });
    try {
      const state = parseWatcherStatus(run(watcherInstallCommand('herdr')));
      expect(state).toEqual({ kind: 'running', version: WATCHER_VERSION, service: 'systemd', lingering: true });
      const unit = readFileSync(join(home, '.config/systemd/user/dev.herdr.herdrchat-notifier.service'), 'utf8');
      expect(unit).toContain(`Environment="HERDR_BIN=${home}/bin/herdr"`);
      expect(unit).toContain('Restart=always');
      expect(readFileSync(join(home, 'systemctl.log'), 'utf8')).toContain('--user enable dev.herdr.herdrchat-notifier.service');
    } finally {
      cleanup();
    }
  });

  it('falls back to a background process, and can be removed', () => {
    const { run, cleanup } = host('Linux');
    try {
      expect(parseWatcherStatus(run(watcherInstallCommand('herdr')))).toMatchObject({ kind: 'running', service: 'process' });
      run(watcherRemoveCommand());
      expect(parseWatcherStatus(run(watcherStatusCommand()))).toEqual({ kind: 'missing', manual: false });
    } finally {
      cleanup();
    }
  });
});
