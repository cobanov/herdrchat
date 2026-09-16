import { Stack, useLocalSearchParams } from 'expo-router';

import ThreadScreen from '@/features/thread/ThreadScreen';
import { AdaptiveColumns, useTabletLayout } from '@/components/AdaptiveColumns';
import ChatsList from '@/features/chats/ChatsList';
import { useSelectedConnection } from '@/state/connections';

export default function ThreadRoute() {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>();
  const connection = useSelectedConnection();
  const wide = useTabletLayout();
  return (
    <AdaptiveColumns sidebar={<ChatsList selectedWorkspaceId={workspaceId} />}>
      <Stack.Screen options={{ gestureEnabled: !wide }} />
      <ThreadScreen key={`${connection?.id ?? ''}:${workspaceId}`} />
    </AdaptiveColumns>
  );
}
