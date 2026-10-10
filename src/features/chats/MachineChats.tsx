import { useEffect, useMemo } from 'react';

import { machineConnectionId, type HostMachine } from '@/lib/herdr/machines';
import { clientFor, machineConnection, type ServerConnection } from '@/state/connections';
import { useEnabledMachines, useMachineFeeds } from './useHostChats';
import { useWorkspaces } from './useWorkspaces';

/**
 * One poll per enabled machine of a host, each publishing what it sees for
 * `useHostChats` to merge. Draws nothing.
 *
 * Keyed by machine, so a machine the host stops listing unmounts its poll and
 * takes its rows with it, and a new one starts from nothing.
 */
export function MachineFeeds({ host }: { host: ServerConnection }) {
  const machines = useEnabledMachines(host.id);
  return (
    <>
      {machines.map((machine) => (
        <MachineChats key={machine.id} host={host} machine={machine} />
      ))}
    </>
  );
}

/**
 * One machine's chats: `useWorkspaces` on a client that reaches the machine
 * through its host. The connection id has a slash, so this poll asks neither
 * for a theme (the host's applies) nor for the machine's own machines.
 */
export function MachineChats({ host, machine }: { host: ServerConnection; machine: HostMachine }) {
  const id = machineConnectionId(host.id, machine.id);
  const client = useMemo(() => clientFor(machineConnection(host, machine)), [host, machine]);
  const { summaries, error, errorCode, refresh } = useWorkspaces(client, id);

  // Publishing to a store outside the tree is a side effect, so it is an
  // effect; nothing here sets this component's own state.
  useEffect(() => {
    useMachineFeeds.getState().publish(id, { summaries, error, errorCode, refresh });
  }, [id, summaries, error, errorCode, refresh]);
  useEffect(() => () => useMachineFeeds.getState().drop(id), [id]);

  return null;
}
