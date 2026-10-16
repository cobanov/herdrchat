import { useEffect, useMemo } from 'react';

import { clientFor, type ServerConnection } from '@/state/connections';
import { useHostFeeds, useOtherHosts } from './useHostChats';
import { useWorkspaces } from './useWorkspaces';

/**
 * One poll per saved host besides the selected one, each publishing what it
 * sees for `useHostChats` to merge. Draws nothing.
 *
 * Keyed by host, so a host that is removed unmounts its poll and takes its
 * rows with it, and a new one starts from nothing.
 */
export function HostFeeds({ selectedId }: { selectedId: string }) {
  const others = useOtherHosts(selectedId);
  return (
    <>
      {others.map((host) => (
        <HostFeed key={host.id} host={host} />
      ))}
    </>
  );
}

/**
 * One other host's chats: `useWorkspaces` on its own client. Not the primary
 * poll, so it sets neither the app's theme nor the herdr version Settings shows.
 */
export function HostFeed({ host }: { host: ServerConnection }) {
  const client = useMemo(() => clientFor(host), [host]);
  const { summaries, error, errorCode, refresh } = useWorkspaces(client, host.id, false);

  // Publishing to a store outside the tree is a side effect, so it is an
  // effect; nothing here sets this component's own state.
  useEffect(() => {
    useHostFeeds.getState().publish(host.id, { summaries, error, errorCode, refresh });
  }, [host.id, summaries, error, errorCode, refresh]);
  useEffect(() => () => useHostFeeds.getState().drop(host.id), [host.id]);

  return null;
}
