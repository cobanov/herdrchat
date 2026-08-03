/**
 * POSIX single-quoting, so arbitrary user text is safe inside a command. Every
 * argument that came from a person or a herdr response goes through this before
 * it is interpolated into a shell string.
 */
export function shellQuote(argument: string): string {
  return `'${argument.replaceAll("'", `'\\''`)}'`;
}

/** Quote an argv into a single shell command line. */
export function shellCommand(argv: readonly string[]): string {
  return argv.map(shellQuote).join(' ');
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
