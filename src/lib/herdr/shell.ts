/**
 * POSIX single-quoting, so arbitrary user text is safe inside a command. Every
 * argument that came from a person or a herdr response goes through this before
 * it is interpolated into a shell string.
 */
export function shellQuote(argument: string): string {
  return `'${argument.replaceAll("'", `'\\''`)}'`;
}

/**
 * The program word of a command: quoted, except that a leading `~/` becomes
 * `"$HOME"/`.
 *
 * A herdr path typed as `~/.local/bin/herdr` went through `shellQuote`, where a
 * tilde is not expanded, so the command exited 127 and the diagnosis told the
 * user to set the herdr path they had just set (#106). Only the `~/` prefix is
 * rewritten; the rest stays single-quoted.
 */
export function commandWord(path: string): string {
  return path.startsWith('~/') ? `"$HOME"/${shellQuote(path.slice(2))}` : shellQuote(path);
}

/** Quote an argv into a single shell command line. `argv[0]` is the program. */
export function shellCommand(argv: readonly string[]): string {
  return argv.map((argument, index) => (index === 0 ? commandWord(argument) : shellQuote(argument))).join(' ');
}

/**
 * Prefix a command with a COMPLETE PATH.
 *
 * Non-interactive SSH shells don't load the user's profile, so herdr's install
 * dir (~/.local/bin, Homebrew) usually isn't on PATH and `herdr` resolves to
 * command-not-found (exit 127). The standard system directories are spelled out
 * rather than trusting the inherited `$PATH`: zsh sources `.zshenv` on every
 * exec so it has a full PATH, but an `sh` login shell sources nothing
 * non-interactively and may inherit only a minimal PATH from sshd — which broke
 * connecting for sh users, where even `ls` and `tail` could be missing.
 */
export function withPath(command: string): string {
  return `export PATH="$HOME/.local/bin:$HOME/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"; ${command}`;
}

/**
 * Run a long-lived command so that it stops when the client stops reading.
 *
 * Closing an SSH channel does not stop the command behind it: sshd keeps the
 * session open while the child runs ("session_close_by_channel: has child"),
 * and a `tail -f` on a quiet transcript never writes, so it never finds out.
 * Every thread the app left behind a `tail -f` and every event bridge stayed
 * running on the host, for hours (#4 acceptance, seen on both platforms).
 *
 * What the command does notice is its stdin: the clients keep it open for the
 * life of the channel, and sshd closes it when the channel closes. So stdin is
 * set aside for a watcher, the command gets /dev/null, and the watcher stops
 * the command's leaf processes on end of input. Leaves rather than the whole
 * tree, so a compound command's own cleanup (the FIFO bridge's) still runs.
 * When the command ends by itself, the watcher goes and its exit status is the
 * stream's.
 *
 * Portable across the login shells commands arrive in: no `status` (read-only
 * in zsh), and process lists come from command substitution, which zsh splits
 * where it would not split a variable.
 */
export function untilChannelCloses(command: string): string {
  return [
    'exec 3<&0',
    'hc_leaves() { if pgrep -P "$1" >/dev/null 2>&1; then for hc_c in $(pgrep -P "$1"); do hc_leaves "$hc_c"; done; else kill "$1" 2>/dev/null; fi; }',
    `{ ${command}`,
    '} </dev/null &',
    'hc_job=$!',
    '( cat <&3 >/dev/null; hc_leaves "$hc_job" ) &',
    'hc_watch=$!',
    'wait "$hc_job"; hc_rc=$?',
    'hc_leaves "$hc_watch"',
    'exit "$hc_rc"',
  ].join('\n');
}
