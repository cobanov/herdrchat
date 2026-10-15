import { useCallback, useMemo } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import type { HerdrClient } from '@/lib/herdr/client';
import { machineConnectionId, type HostMachine } from '@/lib/herdr/machines';
import { clientFor, machineConnection, type ServerConnection } from '@/state/connections';
import { enabledMachines, useHostMachines } from '@/state/hostMachines';
import { listChats, machineNotice, type ListedChat } from './listedChat';
import { useWorkspaces, type ChatSummary } from './useWorkspaces';

/**
 * One host's chats, and the chats of every enabled machine saved on it, as
 * one list.
 *
 * herdr on the host federates its machines (`herdr machine add`), so a person
 * at the host's desktop sees a machine's sessions beside the host's own. The
 * app asked the host for one snapshot and showed only that, so a chat running
 * on a machine was invisible on the phone. Each machine now gets its own
 * `useWorkspaces`, reached through the host (`withMachine`), and its rows are
 * merged in after the host's, tagged with where they live (`ListedChat`).
 *
 * Hooks cannot be called in a loop, so each machine's poll runs in a
 * `MachineChats` child (rendered by `MachineFeeds`) that publishes what it
 * sees to the store below; this hook reads it back. The store holds only the
 * live poll's state and is dropped as each child unmounts.
 *
 * The host's own error and loading are the list's, exactly as before: every
 * machine is reached through the host, so a host that is down is the whole
 * story. A machine's failure is only a notice at the end of the list, and its
 * rows stay as last seen until the host stops listing it as enabled.
 */

/** What one machine's poll last saw. */
export interface MachineFeed {
  summaries: ChatSummary[];
  error: string | null;
  errorCode: string | null;
  refresh: () => Promise<void>;
}

/** Live poll state per machine connection id. Never persisted. */
export const useMachineFeeds = create<{
  feeds: Readonly<Record<string, MachineFeed>>;
  publish: (connectionId: string, feed: MachineFeed) => void;
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

/** A machine whose last poll failed, as the one line the list gives it. */
export interface MachineNoticeRow {
  machineId: string;
  label: string;
  text: string;
}

export interface HostChatsState {
  /** The host's rows, then each machine's, in the host's order of machines. */
  summaries: ListedChat[];
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  notices: MachineNoticeRow[];
  /** The host's id and each enabled machine's: whose reads and prefs to load. */
  connectionIds: readonly string[];
  /** Refreshes the host and every machine. */
  refresh: () => Promise<void>;
  /** The client and connection a row's actions run on: the machine's for a machine's row. */
  targetOf: (summary: ListedChat) => { client: HerdrClient; connectionId: string } | null;
}

const NO_MACHINES: readonly HostMachine[] = [];

/** The enabled machines of a host, stable while they are unchanged. */
export function useEnabledMachines(hostId: string | null): readonly HostMachine[] {
  return useHostMachines(useShallow((state) => (hostId === null ? NO_MACHINES : enabledMachines(state.byHost, hostId))));
}

export function useHostChats(host: ServerConnection | null, client: HerdrClient | null): HostChatsState {
  const hostId = host?.id ?? null;
  const own = useWorkspaces(client, hostId);
  const machines = useEnabledMachines(hostId);
  const feeds = useMachineFeeds((state) => state.feeds);

  const summaries = useMemo(() => {
    if (hostId === null) return [];
    const rows = listChats(own.summaries, hostId, null);
    for (const machine of machines) {
      const id = machineConnectionId(hostId, machine.id);
      const feed = feeds[id];
      if (feed !== undefined) rows.push(...listChats(feed.summaries, id, { id: machine.id, label: machine.label }));
    }
    return rows;
  }, [hostId, own.summaries, machines, feeds]);

  // A host that is down takes its machines with it; their notices would only
  // repeat its own error, which the list already shows.
  const notices = useMemo(() => {
    if (hostId === null || own.error !== null) return [];
    return machines.flatMap((machine): MachineNoticeRow[] => {
      const feed = feeds[machineConnectionId(hostId, machine.id)];
      if (feed === undefined || feed.error === null) return [];
      return [{ machineId: machine.id, label: machine.label, text: machineNotice(machine.label, feed.error, feed.errorCode) }];
    });
  }, [hostId, own.error, machines, feeds]);

  const connectionIds = useMemo(
    () => (hostId === null ? [] : [hostId, ...machines.map((machine) => machineConnectionId(hostId, machine.id))]),
    [hostId, machines]
  );

  const hostRefresh = own.refresh;
  const refresh = useCallback(async () => {
    // Read at call time: the machines' refresh functions change with their
    // clients, and a pull should reach whichever polls are running now.
    const running = hostId === null ? [] : machines.flatMap((machine) => {
      const feed = useMachineFeeds.getState().feeds[machineConnectionId(hostId, machine.id)];
      return feed === undefined ? [] : [feed.refresh()];
    });
    await Promise.all([hostRefresh(), ...running]);
  }, [hostRefresh, hostId, machines]);

  const targetOf = useCallback(
    (summary: ListedChat) => {
      if (host === null || client === null) return null;
      if (summary.machine === null) return { client, connectionId: host.id };
      const machineId = summary.machine.id;
      const machine = machines.find((item) => item.id === machineId);
      if (machine === undefined) return null;
      const connection = machineConnection(host, machine);
      return { client: clientFor(connection), connectionId: connection.id };
    },
    [host, client, machines]
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
