import { sshJump } from '../herdr/machine';
import { DEFAULT_SESSION, isNamedSession } from '../herdr/session';
import { commandWord, shellCommand, shellQuote, withPath } from '../herdr/shell';
import { JUMP_CONNECT_TIMEOUT_MS, TERMINAL_START_TIMEOUT_MS } from '../herdr/timeouts';

/**
 * The command a terminal runs on the host to show one herdr pane.
 *
 * Measured on herdr 0.9 over a real SSH PTY (2026-10-11):
 *
 * - `herdr agent attach <pane>` attaches to an AGENT pane only. It draws the
 *   pane at the client's PTY size, and gives the pane its own size back when
 *   the channel hangs up. A shell pane answers `agent_not_found`, by pane id
 *   and by terminal id alike.
 * - `herdr session attach <name>` attaches to the whole multiplexer, from an
 *   SSH PTY (not nested inside herdr, so it is allowed). Zooming the pane
 *   first makes it fill the view.
 *
 * So an agent pane gets `agent attach`, and a shell pane gets `pane zoom` and
 * `session attach`. The third way, polling `pane read` into the emulator, was
 * not needed and is not built.
 *
 * What a shell pane's attach shows, measured on herdr 0.9.3 against a
 * throwaway session over a PTY (2026-10-11):
 *
 * - `pane zoom --on` on a pane in a tab that is not active, in a workspace
 *   that is not focused, makes that workspace focused and that tab active, and
 *   focuses the pane. A client that attaches after it opens on that pane, so
 *   no separate workspace or tab focus is needed first.
 * - At 64 columns or fewer (a phone held upright) herdr draws its mobile
 *   layout: a two-line header over the pane, no sidebar. Wider (an iPad, a
 *   phone on its side) it draws its sidebar, about 25 columns, beside the
 *   pane; herdr's prefix then `b` hides it.
 * - herdr's prefix key (Ctrl-B by default) is herdr's, not the pane's: Ctrl-B
 *   typed for the program (vim's page up, readline's back a character) is
 *   taken by herdr and does not reach it.
 * - `pane zoom --off` focuses the pane too, which is why leaving unzooms
 *   first and only then gives the focus back.
 *
 * ZOOM AND FOCUS ARE SHARED STATE. `pane zoom --on` zooms the pane for every
 * client attached to the session, the desktop's too, and moves herdr's focus
 * to it. Leaving the terminal undoes the zoom (`leaveShellPane`) when the app
 * was the one that zoomed it; the focus goes back through the socket API's
 * `pane.focus`, since the CLI only focuses a pane by direction.
 *
 * Everything here is ONE string for the native PTY (`openShell` in
 * herdr-ssh), which types ` exec /bin/sh -c '<marker>; <command>'` into the
 * login shell. That login shell may be fish, which keeps `\\` and `\'` special
 * inside single quotes, so the command must contain no backslash at all. The
 * usual quoting writes a quote as `'\''`; here it is `'"'"'`, which every
 * POSIX shell and fish read the same way (`noBackslashes`).
 */

/** Which attach path a pane takes. */
export type TerminalPaneKind = 'agent' | 'shell';

/**
 * An agent pane is one herdr detected an agent in, any agent, conversational
 * or not: `agent attach` answers for all of them. A pane with none is a shell.
 */
export function paneKind(agent: string | null): TerminalPaneKind {
  return agent === null ? 'shell' : 'agent';
}

/** Where the pane is and how to reach its herdr. */
export interface TerminalTarget {
  paneId: string;
  kind: TerminalPaneKind;
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
 * The command to run on the host, or null when it cannot be written without a
 * backslash (a pane id, path, session or machine target with a `\` in it, none
 * of which herdr or ssh produce).
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
  const session = isNamedSession(target.session) ? target.session.trim() : null;
  if ([target.paneId, herdrPath, session ?? ''].some((part) => part.includes('\\'))) return null;
  const herdr = commandWord(herdrPath);
  const parts = [LOCALE];
  if (session !== null) parts.push(`export HERDR_SESSION=${shellQuote(session)}`);
  if (target.kind === 'agent') {
    parts.push(`exec ${shellCommand([herdrPath, 'agent', 'attach', target.paneId])}`);
  } else {
    // Zoom first, so the pane fills the view the attach draws. A herdr
    // without zoom still attaches, to the whole session, rather than failing.
    // Its JSON reply would land on the screen after the launch marker, so it
    // goes nowhere.
    parts.push(`${herdr} pane zoom --pane ${shellQuote(target.paneId)} --on >/dev/null 2>&1`);
    parts.push(`exec ${shellCommand([herdrPath, 'session', 'attach', session ?? DEFAULT_SESSION])}`);
  }
  return noBackslashes(withPath(parts.join('; ')));
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

/**
 * What to undo when a shell pane's terminal closes: herdr's zoom, unless the
 * pane was already zoomed before the app zoomed it, and the focus, back to
 * the pane that had it.
 *
 * The zoom goes through the CLI (`unzoomCommand`, run through the same
 * transport as everything else, so a machine's goes to the machine), and the
 * focus through the socket's `pane.focus`, which is the only direct focus
 * herdr has. Either may fail on an old herdr; both are best-effort.
 */
export interface ShellPaneLeave {
  /** Null when the zoom was there before: undoing it would undo the person's own. */
  unzoom: string | null;
  /** The socket request that gives focus back, or null when nothing moved it. */
  refocus: { method: 'pane.focus'; params: { pane_id: string } } | null;
}

/** Zoom and focus as they were before the terminal opened, from the last snapshot. */
export interface PaneViewBefore {
  /** The tab's `zoomed`, when its focused pane was this one. */
  zoomed: boolean;
  /** herdr's focused pane (`focused_pane_id`), when the snapshot had one. */
  focusedPaneId: string | null;
}

export function leaveShellPane(paneId: string, before: PaneViewBefore): ShellPaneLeave {
  return {
    unzoom: before.zoomed ? null : unzoomCommand(paneId),
    refocus:
      before.focusedPaneId === null || before.focusedPaneId === paneId
        ? null
        : { method: 'pane.focus', params: { pane_id: before.focusedPaneId } },
  };
}

/**
 * `herdr pane zoom --pane <id> --off`, for the client's transport (which adds
 * the PATH, the session and the machine jump). `herdr` by name: the client's
 * own path is private to it, and the transport's `withPath` covers the usual
 * install places. The pane must be passed as `--pane`; positionally herdr
 * answers "unknown option".
 */
export function unzoomCommand(paneId: string, herdrPath = 'herdr'): string {
  return withPath(shellCommand([herdrPath, 'pane', 'zoom', '--pane', paneId, '--off']));
}

/**
 * Whether the pane's tab was already zoomed on it, from the snapshot's layouts.
 * Only that pane's tab counts: a zoom on another tab is not this terminal's.
 */
export function zoomedOn(
  layouts: readonly { focusedPaneId: string | null; zoomed: boolean; panes: readonly { paneId: string }[] }[] | null,
  paneId: string
): boolean {
  const tab = layouts?.find((layout) => layout.panes.some((pane) => pane.paneId === paneId));
  return tab !== undefined && tab.zoomed && tab.focusedPaneId === paneId;
}
