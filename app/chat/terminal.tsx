import { useLocalSearchParams, useRouter } from 'expo-router';

import type { TerminalRouteParams } from '@/features/terminal/navigation';
import TerminalScreen from '@/features/terminal/TerminalScreen';

/**
 * A pane's terminal, pushed above whatever opened it: the chats (a terminal
 * row) or a chat (its header's Terminal), on iPad over the split. Keyed by
 * the pane, so another pane is another shell, never this one re-pointed.
 */
export default function TerminalRoute() {
  const params = useLocalSearchParams<Partial<Record<keyof TerminalRouteParams, string>>>();
  const router = useRouter();
  const connectionId = params.connectionId ?? '';
  const paneId = params.paneId ?? '';
  return (
    <TerminalScreen
      key={`${connectionId}:${paneId}`}
      connectionId={connectionId}
      paneId={paneId}
      kind={params.kind === 'agent' ? 'agent' : 'shell'}
      title={params.title !== undefined && params.title !== '' ? params.title : 'Terminal'}
      onBack={() => router.back()}
    />
  );
}
