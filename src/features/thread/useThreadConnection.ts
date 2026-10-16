import { useMemo } from 'react';

import { splitMachineConnectionId } from '@/lib/herdr/machines';
import {
  clientFor,
  isMachineConnection,
  useConnectionFor,
  useConnections,
  useSelectedConnection,
} from '@/state/connections';
import { useHostMachines } from '@/state/hostMachines';

/**
 * The connection a chat is on, its client, and whether it is gone.
 *
 * From the route, not the selected host: a chat on one of the host's
 * machines is read, followed and sent to through the machine's client, whose
 * transport jumps through the host. `useThread` and the transcript store see
 * only a transport, so nothing below knows the difference. Absent from the
 * route (a notification, an older link): the selected host.
 */
export function useThreadConnection(connectionId: string | undefined) {
  const selected = useSelectedConnection();
  const wantedId = connectionId !== undefined && connectionId !== '' ? connectionId : selected?.id ?? null;
  const connection = useConnectionFor(wantedId);
  const client = useMemo(() => (connection === null ? null : clientFor(connection)), [connection]);
  /** The machine's label, which leads the subtitle, when the chat is on one. */
  const machineLabel = connection !== null && isMachineConnection(connection) ? connection.name : null;

  /**
   * This route outlives its host: delete the connection, or follow a deep link
   * or a notification into one that is gone, and the screen still opens. It
   * used to answer that with "No messages yet · Send your first message" over a
   * composer whose every send failed silently.
   *
   * Hydration is what makes the difference honest, before the store has read
   * the device, a null connection means "not loaded", not "deleted".
   */
  const hydrated = useConnections((state) => state.hydrated);
  const hostGone = hydrated && connection === null;
  // A machine is gone when its host is still here but no longer lists it as
  // enabled; the placeholder then says so, rather than that the host is gone.
  const machineIds = wantedId === null ? null : splitMachineConnectionId(wantedId);
  const viaHost = useConnectionFor(machineIds?.hostId ?? null);
  // A disabled machine stays in its host's cached list, so its label is
  // usually still known, for the command that brings it back.
  const goneLabel = useHostMachines((state) =>
    machineIds === null ? null : state.byHost[machineIds.hostId]?.find((item) => item.id === machineIds.machineId)?.label ?? null);
  const goneMachine = hostGone && viaHost !== null ? { label: goneLabel, host: viaHost.name } : null;

  return { connection, client, machineLabel, hostGone, goneMachine };
}
