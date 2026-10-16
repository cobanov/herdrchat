import { useMemo } from 'react';

import { machineConnection, useSelectedConnection, type Connection } from '@/state/connections';
import { enabledMachines, useHostMachines } from '@/state/hostMachines';

/** A computer the Computers tab can open: the selected host, or one of its machines. */
export interface Device {
  connection: Connection;
  name: string;
  /** `Host · you@address`, or `Machine · its SSH target`. */
  detail: string;
}

/**
 * The selected host first, then the machines saved on it (`herdr machine
 * add`), as its chat list shows them. The app only dials the host; a machine
 * is reached from there, which is why it lives under its host.
 */
export function useDevices(): readonly Device[] {
  const host = useSelectedConnection();
  const byHost = useHostMachines((state) => state.byHost);
  return useMemo(() => {
    if (host === null) return [];
    return [
      { connection: host, name: host.name, detail: `Host · ${host.username}@${host.host}` },
      ...enabledMachines(byHost, host.id).map((machine) => ({
        connection: machineConnection(host, machine),
        name: machine.label,
        detail: `Machine · ${machine.target}`,
      })),
    ];
  }, [host, byHost]);
}
