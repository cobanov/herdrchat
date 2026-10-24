import { isSplitDevice } from '@/components/AdaptiveColumns';
import { useOtherHosts } from '@/features/chats/useHostChats';
import { useSelectedConnection } from '@/state/connections';
import { useChatSelection, type Detail } from '@/state/chatSelection';

/**
 * The detail the chats screen shows: the selection, on a device that opens
 * chats in place (`isSplitDevice`), while its host is listed.
 *
 * Workspace ids are only unique on their host. Never carry a selection onto
 * a list that does not hold its host: one on any listed host stays.
 */
export function useShownDetail(): Detail | null {
  const connection = useSelectedConnection();
  const detail = useChatSelection((state) => state.detail);
  const others = useOtherHosts(connection?.id ?? null);
  const listed = connection !== null && detail !== null &&
    (detail.connectionId === connection.id || others.some((other) => other.id === detail.connectionId));
  return isSplitDevice() && listed ? detail : null;
}
