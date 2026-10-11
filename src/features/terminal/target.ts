import type { DemoTerminalHost } from '@/lib/demo/terminal';
import { attachCommand, needsNewerHerdr, terminalStartTimeout, type TerminalPaneKind, type TerminalTarget } from '@/lib/terminal/command';
import { isMachineConnection, type Connection } from '@/state/connections';

/** What a pane's terminal opens: on which SSH connection, running what. */
export interface TerminalLaunch {
  /**
   * The connection the shell channel opens on. A machine has no connection of
   * its own: its pane's terminal runs the jump on its host's, as every other
   * command for the machine does.
   */
  hostId: string;
  command: string;
  startTimeoutMs: number;
  /** How the host was addressed, which is what the Demo's recorded screens are matched by. */
  host: DemoTerminalHost;
}

/** The pane a terminal opens: its id, which attach it takes, and its terminal. */
export interface TerminalPaneRef {
  paneId: string;
  kind: TerminalPaneKind;
  /** The snapshot's `terminal_id`; a shell pane is attached by it. */
  terminalId: string | null;
}

/**
 * The launch for one pane on `connection`, or null when no command can be
 * written for it (`attachCommand`: a shell pane without a terminal id, or a
 * backslash in a part of it).
 *
 * `connection` is the chat's: a host, or one of its machines. Kept apart from
 * the screen so the choice of connection and session, which is what makes a
 * machine's pane open on the machine, is one function a test pins.
 *
 * `takeover` is only ever set by the person's Take over.
 */
export function terminalLaunch(connection: Connection, pane: TerminalPaneRef, takeover = false): TerminalLaunch | null {
  const { paneId, kind, terminalId } = pane;
  if (isMachineConnection(connection)) {
    const target: TerminalTarget = {
      paneId,
      kind,
      terminalId,
      takeover,
      herdrPath: 'herdr',
      session: connection.machine.session,
      machine: { target: connection.machine.target },
    };
    const command = attachCommand(target);
    return command === null ? null : {
      hostId: connection.via,
      command,
      startTimeoutMs: terminalStartTimeout(target),
      host: { herdrPath: connection.host.herdrPath, session: connection.host.sessionName },
    };
  }
  const target: TerminalTarget = { paneId, kind, terminalId, takeover, herdrPath: connection.herdrPath, session: connection.sessionName };
  const command = attachCommand(target);
  return command === null ? null : {
    hostId: connection.id,
    command,
    startTimeoutMs: terminalStartTimeout(target),
    host: { herdrPath: connection.herdrPath, session: connection.sessionName },
  };
}

/** What the screen says for a pane `terminalLaunch` has no command for. */
export function noLaunchMessage(pane: Pick<TerminalPaneRef, 'kind' | 'terminalId'>): string {
  return needsNewerHerdr(pane)
    ? "This pane can't be opened on this herdr. It needs herdr 0.9 or newer."
    : "This pane's id can't be passed to herdr safely.";
}
