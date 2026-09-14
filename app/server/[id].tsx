import { useLocalSearchParams } from 'expo-router';

import ServerEditScreen from '@/features/servers/ServerEditScreen';

export default function ServerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ServerEditScreen key={id} />;
}
