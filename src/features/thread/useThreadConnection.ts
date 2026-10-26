import { useMemo } from 'react';

import {
  clientFor,
  useConnectionFor,
  useConnections,
  useSelectedConnection,
} from '@/state/connections';

/**
 * The connection a chat is on, its client, and whether it is gone.
 *
 * From the route, not the selected host: a chat on another host is read,
 * followed and sent to through that host's client. Absent from the route (a
 * notification, an older link): the selected host.
 */
export function useThreadConnection(connectionId: string | undefined) {
  const selected = useSelectedConnection();
  const wantedId = connectionId !== undefined && connectionId !== '' ? connectionId : selected?.id ?? null;
  const connection = useConnectionFor(wantedId);
  const client = useMemo(() => (connection === null ? null : clientFor(connection)), [connection]);
  /** The host's name, which leads the subtitle, when it is not the selected host. */
  const hostLabel = connection !== null && connection.id !== selected?.id ? connection.name : null;

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

  return { connection, client, hostLabel, hostGone };
}
