import { useLocalSearchParams } from 'expo-router';

import ThreadScreen from '@/features/thread/ThreadScreen';
import { useSelectedConnection } from '@/state/connections';

export default function ThreadRoute() {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>();
  const connection = useSelectedConnection();
  return <ThreadScreen key={`${connection?.id ?? ''}:${workspaceId}`} />;
}
