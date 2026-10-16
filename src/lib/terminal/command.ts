import { sshJump } from '../herdr/machine';
import { isNamedSession } from '../herdr/session';
import { shellCommand, shellQuote, withPath } from '../herdr/shell';
import { JUMP_CONNECT_TIMEOUT_MS, TERMINAL_START_TIMEOUT_MS } from '../herdr/timeouts';

/**
 * The command a terminal runs on the host to show one herdr pane.
 *
 * Every pane attaches PRIVATELY: herdr draws that one pane to this client and
 * nothing on the host moves. Measured on herdr 0.9.3 over a PTY (2026-10-11):
 *
 * - `herdr agent attach <pane>` is, in herdr's source, "find the agent's
 *   terminal" followed by the same terminal attach that
 *   `herdr terminal attach <terminal_id> [--takeover]` runs (added in herdr
 *   0.9.0). The second takes ANY pane's terminal id, a shell pane's included,
 *   and refuses a pane id (`terminal w4:pB not found`): the id comes from the
 *   snapshot's `terminal_id`.
 * - `terminal attach` on a shell pane draws the pane alone, with no sidebar
 *   and no header; typing reaches it; herdr's prefix (Ctrl-B) then `q`
 *   detaches and the command exits 0. herdr's focused pane was the same
 *   before, during and after: no zoom, no focus, no sidebar moved.
 * - A second attach on a terminal that already has one exits 1, with
 *   "terminal term_… already has an attached client; retry with --takeover"
 *   on the screen, and the first stays up. `--takeover` (measured only with
 *   no other client: it behaves the same) is, by herdr's own hint, how a
 *   second client takes the pane and detaches the first; what the first
 *   then shows is on the device checklist. A desktop's herdr on the session is not such a
 *   client: the first attach needs no `--takeover` while it is up.
 * - What stays shared, as in any PTY two clients share (tmux too): while
 *   attached, the pane is drawn at this client's size, and gets its own back
 *   on detach.
 * - herdr's prefix key (Ctrl-B by default) is herdr's, not the pane's: Ctrl-B
 *   typed for the program (vim's page up) is taken by herdr.
 * - Without a TTY it fails (`Inappropriate ioctl for device`); the app always
 *   gives it a PTY.
 *
 * So an agent pane gets `agent attach` (it needs no terminal id), and a shell
 * pane `terminal attach`. The shell pane's earlier path, `pane zoom --on` and
 * then `session attach`, is gone: zoom, focus and the sidebar are herdr's
 * SHARED state, so the desktop zoomed with the phone and the sidebar on an
 * iPad moved the desktop along. "Affecting the state of other viewers or
 * clients is unacceptable" (Kenneth). A herdr too old to send a terminal id
 * gets no terminal for a shell pane rather than that.
 *
 * `--takeover` is only ever the person's choice (the screen's Take over): a
 * reconnect that silently kicked another client off the pane would be the
 * same kind of harm.
 *
 * Everything here is ONE string for the native PTY (`openShell` in
 * herdr-ssh), which types ` exec /bin/sh -c '<marker>; <command>'` into the
 * login shell. That login shell may be fish, which keeps `\\` and `\'` special
 * inside single quotes, so the command must contain no backslash at all. The
 * usual quoting writes a quote as `'\''`; here it is `'"'"'`, which every
 * POSIX shell and fish read the same way (`noBackslashes`).
 */

/** Which attach path a pane takes. */
/**
 * What a terminal opens: an agent's pane, a shell pane (both attached through
 * herdr), or `login`, a plain login shell on the machine itself, for the
 * Terminal tab, with no herdr pane behind it.
 */
export type TerminalPaneKind = 'agent' | 'shell' | 'login';

/**
 * An agent pane is one herdr detected an agent in, any agent, conversational
 * or not: `agent attach` answers for all of them. A pane with none is a shell.
 */
export function paneKind(agent: string | null): 'agent' | 'shell' {
  return agent === null ? 'shell' : 'agent';
}

/** Where the pane is and how to reach its herdr. */
export interface TerminalTarget {
  paneId: string;
  kind: TerminalPaneKind;
  /**
   * The pane's terminal (the snapshot's `terminal_id`), which a shell pane is
   * attached by. Null from a herdr older than 0.9, where a shell pane has no
   * private attach and so no terminal.
   */
  terminalId: string | null;
  /** Take the pane from another attached client. Only ever the person's choice. */
  takeover?: boolean;
  /** The host's `herdr` path (`Connection.herdrPath`); `herdr` on a machine. */
  herdrPath: string;
  /** The herdr session the pane lives in: the host's, or the machine's. */
  session: string | null | undefined;
  /** Set for a pane on one of the host's machines: its SSH target as the host knows it. */
  machine?: { target: string } | null;
}

/**
 * The locale the attach runs under, unless the login already set one. herdr
 * draws in UTF-8 regardless; a herdr that reads the locale would otherwise get
 * none, since sshd passes on only what the client sends, and the app sends
 * nothing.
 */
const LOCALE = 'export LANG="${LANG:-en_US.UTF-8}"';

/**
 * The command to run on the host, or null when there is none: a shell pane
 * without a terminal id (`needsNewerHerdr`), or a part that cannot be written
 * without a backslash (a pane id, terminal id, path, session or machine target
 * with a `\` in it, none of which herdr or ssh produce).
 */
export function attachCommand(target: TerminalTarget): string | null {
  const inner = paneCommand(target, target.machine === undefined || target.machine === null ? target.herdrPath : 'herdr');
  if (inner === null) return null;
  if (target.machine === undefined || target.machine === null) return inner;
  if (target.machine.target.includes('\\')) return null;
  return noBackslashes(withPath(ptyJump(target.machine.target, inner)));
}

/** The command on the computer the pane is on, with its PATH, locale and session. */
function paneCommand(target: TerminalTarget, herdrPath: string): string | null {
  // The user's own login shell, which sets its PATH itself.
  if (target.kind === 'login') return `${LOCALE}; exec "\${SHELL:-/bin/sh}" -l`;
  const session = isNamedSession(target.session) ? target.session.trim() : null;
  if (needsNewerHerdr(target)) return null;
  const attach = target.kind === 'agent'
    ? [herdrPath, 'agent', 'attach', target.paneId]
    : [herdrPath, 'terminal', 'attach', target.terminalId ?? ''];
  if (target.takeover === true) attach.push('--takeover');
  if ([...attach, session ?? ''].some((part) => part.includes('\\'))) return null;
  const parts = [LOCALE];
  if (session !== null) parts.push(`export HERDR_SESSION=${shellQuote(session)}`);
  parts.push(`exec ${shellCommand(attach)}`);
  return noBackslashes(withPath(parts.join('; ')));
}

/**
 * Whether the pane cannot be attached on this herdr at all: a shell pane whose
 * snapshot carried no terminal id, from a herdr older than 0.9. Said as such,
 * never answered with the shared session view.
 */
export function needsNewerHerdr(target: Pick<TerminalTarget, 'kind' | 'terminalId'>): boolean {
  return target.kind === 'shell' && (target.terminalId === null || target.terminalId === '');
}

/**
 * The machine jump of `withMachine`, with a terminal on the machine's end.
 *
 * `sshJump` itself runs without one on purpose (byte offsets would drift on
 * `\r\n`), and it is the builder every jump goes through, so the terminal
 * adds two options to its line rather than writing its own:
 *
 * - `-t`: a PTY on the machine, so herdr there draws for a terminal and gets
 *   the size. The host's `ssh` already runs on the app's PTY, so one `t` is
 *   enough.
 * - `-e none`: no escape character. With a PTY, `ssh` reads `~.` after a
 *   newline as "disconnect", and a person typing `~` in vim would hang up.
 */
export function ptyJump(target: string, command: string): string {
  const line = sshJump(target, command);
  if (!line.startsWith('ssh ')) throw new Error('sshJump no longer starts with ssh');
  return `ssh -t -e none ${line.slice('ssh '.length)}`;
}

/**
 * `shellQuote`'s `'\''` rewritten as `'"'"'`: the same quote to every POSIX
 * shell, and to fish, with no backslash. Only valid on text whose every
 * backslash came from `shellQuote`, which `attachCommand` checks first.
 */
export function noBackslashes(command: string): string {
  return command.replaceAll(`'\\''`, `'"'"'`);
}

/** How long opening the terminal may take: the jump's connect time on top for a machine. */
export function terminalStartTimeout(target: Pick<TerminalTarget, 'machine'>): number {
  return TERMINAL_START_TIMEOUT_MS + (target.machine === undefined || target.machine === null ? 0 : JUMP_CONNECT_TIMEOUT_MS);
}
