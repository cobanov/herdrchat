import { useMemo } from 'react';

import { machineConnection, useSelectedConnection, type Connection } from '@/state/connections';
import { enabledMachines, useHostMachines } from '@/state/hostMachines';

/** A computer the Files and Terminal tabs can open: the selected host, or one of its machines. */
export interface Device {
  connection: Connection;
  name: string;
  /** Where it is reached: `you@host` for the host, through it for a machine. */
  detail: string;
}

/** The selected host first, then the machines saved on it, as its chat list shows them. */
export function useDevices(): readonly Device[] {
  const host = useSelectedConnection();
  const byHost = useHostMachines((state) => state.byHost);
  return useMemo(() => {
    if (host === null) return [];
    return [
      { connection: host, name: host.name, detail: `${host.username}@${host.host}` },
      ...enabledMachines(byHost, host.id).map((machine) => ({
        connection: machineConnection(host, machine),
        name: machine.label,
        detail: `${machine.target} · through ${host.name}`,
      })),
    ];
  }, [host, byHost]);
}
