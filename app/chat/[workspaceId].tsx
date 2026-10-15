import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Platform } from 'react-native';

import { AdaptiveColumns } from '@/components/AdaptiveColumns';
import ThreadScreen from '@/features/thread/ThreadScreen';
import { openChat } from '@/features/chats/navigation';
import { useConnections, useSelectedConnection } from '@/state/connections';

export default function ThreadRoute() {
  // `paneId` names one agent of a workspace; without it this is the workspace chat.
  // `connectionId` is the chat's host, or one of its machines; older links and
  // notifications without it mean the selected host.
  const { workspaceId, title, paneId, connectionId: linked } =
    useLocalSearchParams<{ workspaceId: string; title?: string; paneId?: string; connectionId?: string }>();
  const router = useRouter();
  const selected = useSelectedConnection();
  const connectionId = linked !== undefined && linked !== '' ? linked : selected?.id ?? '';
  const hydrated = useConnections((state) => state.hydrated);
  const tablet = Platform.OS === 'ios' && Platform.isPad;
  // Keep existing notification/deep-link URLs valid without opening a second
  // tablet navigation shell above the root chats.
  useFocusEffect(useCallback(() => {
    if (tablet && hydrated) openChat(connectionId, workspaceId, title, paneId);
  }, [tablet, hydrated, connectionId, workspaceId, title, paneId]));
  if (tablet) return null;
  return (
    <AdaptiveColumns sidebar={null}>
      <ThreadScreen
        key={`${connectionId}:${workspaceId}:${paneId ?? ''}`}
        connectionId={connectionId}
        workspaceId={workspaceId}
        paneId={paneId}
        title={title}
        onBack={() => router.back()}
      />
    </AdaptiveColumns>
  );
}
