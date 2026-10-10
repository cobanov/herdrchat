import type { DemoTerminalHost } from '@/lib/demo/terminal';
import { attachCommand, terminalStartTimeout, type TerminalPaneKind, type TerminalTarget } from '@/lib/terminal/command';
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

/**
 * The launch for one pane on `connection`, or null when no command can be
 * written for it (`attachCommand`: a backslash in a part of it).
 *
 * `connection` is the chat's: a host, or one of its machines. Kept apart from
 * the screen so the choice of connection and session, which is what makes a
 * machine's pane open on the machine, is one function a test pins.
 */
export function terminalLaunch(connection: Connection, paneId: string, kind: TerminalPaneKind): TerminalLaunch | null {
  if (isMachineConnection(connection)) {
    const target: TerminalTarget = {
      paneId,
      kind,
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
  const target: TerminalTarget = { paneId, kind, herdrPath: connection.herdrPath, session: connection.sessionName };
  const command = attachCommand(target);
  return command === null ? null : {
    hostId: connection.id,
    command,
    startTimeoutMs: terminalStartTimeout(target),
    host: { herdrPath: connection.herdrPath, session: connection.sessionName },
  };
}
