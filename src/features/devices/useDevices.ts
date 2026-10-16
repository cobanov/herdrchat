import { useMemo } from 'react';

import { useOtherHosts } from '@/features/chats/useHostChats';
import { useSelectedConnection, type ServerConnection } from '@/state/connections';

/** A computer the Computers tab can open: one of the saved hosts. */
export interface Device {
  connection: ServerConnection;
  name: string;
  /** `you@address`. */
  detail: string;
}

/** The selected host first, then every other saved host, as the chats list orders them. */
export function useDevices(): readonly Device[] {
  const host = useSelectedConnection();
  const others = useOtherHosts(host?.id ?? null);
  return useMemo(
    () => (host === null ? [] : [host, ...others]).map((connection) => ({
      connection,
      name: connection.name,
      detail: `${connection.username}@${connection.host}`,
    })),
    [host, others]
  );
}
