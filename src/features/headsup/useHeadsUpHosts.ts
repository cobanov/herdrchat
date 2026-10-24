import { useMemo } from 'react';

import { useOtherHosts } from '@/features/chats/useHostChats';
import { chatFor, openItems, type HeadsUpChat, type HeadsUpItem } from '@/lib/headsup/items';
import { useConnections, useSelectedConnection } from '@/state/connections';
import { useHeadsUp } from '@/state/headsUp';

/** One item and where it lives. */
export interface HostItem {
  item: HeadsUpItem;
  connectionId: string;
  hostName: string;
  /** The listed chat that raised it, or null when that session isn't running on its host. */
  chat: HeadsUpChat | null;
}

/**
 * The Heads Up items of the given hosts, in their order. A host without the
 * mod (or not looked at yet) has none.
 */
export function useHeadsUpItemsOf(connectionIds: readonly string[]): HostItem[] {
  const connections = useConnections((state) => state.connections);
  const byConnection = useHeadsUp((state) => state.byConnection);
  return useMemo(() => connectionIds.flatMap((connectionId) => {
    const entry = byConnection[connectionId];
    if (entry === undefined || entry.path === null || entry.file === null) return [];
    const hostName = connections.find((connection) => connection.id === connectionId)?.name ?? '';
    return entry.file.items.map((item): HostItem => ({ item, connectionId, hostName, chat: chatFor(item, entry.chats) }));
  }), [connectionIds, connections, byConnection]);
}

/** The open ones, for the chats' bar, over the hosts the list lists. Needs no host's name. */
export function useOpenHeadsUpItems(connectionIds: readonly string[]): HeadsUpItem[] {
  const byConnection = useHeadsUp((state) => state.byConnection);
  return useMemo(() => openItems(connectionIds.flatMap((connectionId) => {
    const entry = byConnection[connectionId];
    return entry === undefined || entry.path === null || entry.file === null ? [] : entry.file.items;
  })), [connectionIds, byConnection]);
}

/**
 * Every listed host's items, for the Heads Up screen: the selected host's and
 * each other host whose chats join its list, as the chat list lists them.
 */
export function useHeadsUpItems(): { items: HostItem[]; hostCount: number } {
  const selected = useSelectedConnection();
  const others = useOtherHosts(selected?.id ?? null);
  const ids = useMemo(() => (selected === null ? [] : [selected.id, ...others.map((host) => host.id)]), [selected, others]);
  const items = useHeadsUpItemsOf(ids);
  return { items, hostCount: ids.length };
}
