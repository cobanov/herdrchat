import { useCallback, useMemo } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import type { HerdrClient } from '@/lib/herdr/client';
import type { HerdrErrorCode } from '@/lib/herdr/protocol';
import { clientFor, isDemo, useConnections, type ServerConnection } from '@/state/connections';
import { listChats, type ListedChat } from './listedChat';
import { useWorkspaces, type ChatSummary } from './useWorkspaces';

/**
 * The selected host's chats, and every other saved host's, as one list.
 *
 * The phone reaches each computer itself, so one list can show every chat on
 * every computer. Each other host gets its own `useWorkspaces` on its own
 * client, and its rows are merged in after the selected host's, tagged with
 * where they live (`ListedChat`).
 *
 * Hooks cannot be called in a loop, so each other host's poll runs in a
 * `HostFeed` child (rendered by `HostFeeds`) that publishes what it sees to
 * the store below; this hook reads it back. The store holds only the live
 * poll's state and is dropped as each child unmounts.
 *
 * The selected host's error and loading are the list's, exactly as before.
 * Another host's failure is only a notice at the end of the list, and its
 * rows stay as last seen.
 */

/** What one other host's poll last saw. */
export interface HostFeed {
  summaries: ChatSummary[];
  error: string | null;
  errorCode: HerdrErrorCode | null;
  refresh: () => Promise<void>;
}

/** Live poll state per other host's id. Never persisted. */
export const useHostFeeds = create<{
  feeds: Readonly<Record<string, HostFeed>>;
  publish: (connectionId: string, feed: HostFeed) => void;
  drop: (connectionId: string) => void;
}>((set) => ({
  feeds: {},
  publish: (connectionId, feed) =>
    set((state) => {
      const held = state.feeds[connectionId];
      // The same poll state again (a re-render of its child) changes nothing,
      // so nothing that reads the feeds re-renders.
      if (held !== undefined && held.summaries === feed.summaries && held.error === feed.error &&
        held.errorCode === feed.errorCode && held.refresh === feed.refresh) return state;
      return { feeds: { ...state.feeds, [connectionId]: feed } };
    }),
  drop: (connectionId) =>
    set((state) => {
      if (!(connectionId in state.feeds)) return state;
      const { [connectionId]: _dropped, ...rest } = state.feeds;
      return { feeds: rest };
    }),
}));

/** Another host whose last poll failed, as the one line the list gives it. */
export interface HostNoticeRow {
  hostId: string;
  label: string;
  text: string;
}

export interface HostChatsState {
  /** The selected host's rows, then each other host's, in the saved order. */
  summaries: ListedChat[];
  loading: boolean;
  error: string | null;
  errorCode: HerdrErrorCode | null;
  notices: HostNoticeRow[];
  /** Every listed host's id: whose reads and prefs to load. */
  connectionIds: readonly string[];
  /** Refreshes every host. */
  refresh: () => Promise<void>;
  /** The client and connection a row's actions run on: its own host's. */
  targetOf: (summary: ListedChat) => { client: HerdrClient; connectionId: string } | null;
}

const NO_HOSTS: readonly ServerConnection[] = [];

/**
 * The saved hosts whose chats join the selected one's list: all the others.
 * The Demo joins no list and no host joins it, so App Review and the e2e
 * flows see the Demo alone. Stable while the hosts are unchanged.
 */
export function useOtherHosts(selectedId: string | null): readonly ServerConnection[] {
  return useConnections(useShallow((state) =>
    selectedId === null || isDemo(selectedId) ? NO_HOSTS
      : state.connections.filter((connection) => connection.id !== selectedId && !isDemo(connection.id))));
}

export function useHostChats(host: ServerConnection | null, client: HerdrClient | null): HostChatsState {
  const hostId = host?.id ?? null;
  const own = useWorkspaces(client, hostId);
  const others = useOtherHosts(hostId);
  const feeds = useHostFeeds((state) => state.feeds);

  const summaries = useMemo(() => {
    if (hostId === null) return [];
    const rows = listChats(own.summaries, hostId, null);
    for (const other of others) {
      const feed = feeds[other.id];
      if (feed !== undefined) rows.push(...listChats(feed.summaries, other.id, { id: other.id, label: other.name }));
    }
    return rows;
  }, [hostId, own.summaries, others, feeds]);

  const notices = useMemo(() => others.flatMap((other): HostNoticeRow[] => {
    const feed = feeds[other.id];
    if (feed === undefined || feed.error === null) return [];
    return [{ hostId: other.id, label: other.name, text: `${other.name}: ${feed.error}` }];
  }), [others, feeds]);

  const connectionIds = useMemo(
    () => (hostId === null ? [] : [hostId, ...others.map((other) => other.id)]),
    [hostId, others]
  );

  const hostRefresh = own.refresh;
  const refresh = useCallback(async () => {
    // Read at call time: the other hosts' refresh functions change with their
    // clients, and a pull should reach whichever polls are running now.
    const running = others.flatMap((other) => {
      const feed = useHostFeeds.getState().feeds[other.id];
      return feed === undefined ? [] : [feed.refresh()];
    });
    await Promise.all([hostRefresh(), ...running]);
  }, [hostRefresh, others]);

  const targetOf = useCallback(
    (summary: ListedChat) => {
      if (host === null || client === null) return null;
      if (summary.host === null) return { client, connectionId: host.id };
      const otherId = summary.host.id;
      const other = others.find((item) => item.id === otherId);
      return other === undefined ? null : { client: clientFor(other), connectionId: other.id };
    },
    [host, client, others]
  );

  return {
    summaries,
    loading: own.loading,
    error: own.error,
    errorCode: own.errorCode,
    notices,
    connectionIds,
    refresh,
    targetOf,
  };
}
