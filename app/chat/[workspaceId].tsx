import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Platform } from 'react-native';

import { AdaptiveColumns } from '@/components/AdaptiveColumns';
import ThreadScreen from '@/features/thread/ThreadScreen';
import { openChat } from '@/features/chats/navigation';
import { useConnections, useSelectedConnection } from '@/state/connections';

export default function ThreadRoute() {
  const { workspaceId, title } = useLocalSearchParams<{ workspaceId: string; title?: string }>();
  const router = useRouter();
  const connection = useSelectedConnection();
  const hydrated = useConnections((state) => state.hydrated);
  const tablet = Platform.OS === 'ios' && Platform.isPad;
  // Keep existing notification/deep-link URLs valid without opening a second
  // tablet navigation shell above the tabs.
  useFocusEffect(useCallback(() => {
    if (tablet && hydrated) openChat(connection?.id ?? '', workspaceId, title);
  }, [tablet, hydrated, connection?.id, workspaceId, title]));
  if (tablet) return null;
  return (
    <AdaptiveColumns sidebar={null}>
      <ThreadScreen key={`${connection?.id ?? ''}:${workspaceId}`} workspaceId={workspaceId} title={title} onBack={() => router.back()} />
    </AdaptiveColumns>
  );
}
