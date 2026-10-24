import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { AdaptiveColumns, isSplitDevice } from '@/components/AdaptiveColumns';
import ThreadScreen from '@/features/thread/ThreadScreen';
import { openChat } from '@/features/chats/navigation';
import { useConnections, useSelectedConnection } from '@/state/connections';

export default function ThreadRoute() {
  // `paneId` names one agent of a workspace; without it this is the workspace chat.
  // `connectionId` is the chat's host; older links and
  // notifications without it mean the selected host.
  const { workspaceId, title, paneId, sig, connectionId: linked } =
    useLocalSearchParams<{ workspaceId: string; title?: string; paneId?: string; sig?: string; connectionId?: string }>();
  const router = useRouter();
  const selected = useSelectedConnection();
  const connectionId = linked !== undefined && linked !== '' ? linked : selected?.id ?? '';
  const hydrated = useConnections((state) => state.hydrated);
  const tablet = isSplitDevice();
  // Keep existing notification/deep-link URLs valid without opening a second
  // tablet navigation shell above the root chats.
  useFocusEffect(useCallback(() => {
    if (tablet && hydrated) openChat(connectionId, workspaceId, title, paneId, sig);
  }, [tablet, hydrated, connectionId, workspaceId, title, paneId, sig]));
  if (tablet) return null;
  return (
    <AdaptiveColumns sidebar={null}>
      <ThreadScreen
        key={`${connectionId}:${workspaceId}:${paneId ?? ''}`}
        connectionId={connectionId}
        workspaceId={workspaceId}
        paneId={paneId}
        listedSig={sig}
        title={title}
        onBack={() => router.back()}
      />
    </AdaptiveColumns>
  );
}
