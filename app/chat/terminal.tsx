import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Platform } from 'react-native';

import { openTerminal, terminalIdParam, type TerminalRouteParams } from '@/features/terminal/navigation';
import TerminalScreen from '@/features/terminal/TerminalScreen';
import { useConnections } from '@/state/connections';

/**
 * A pane's terminal on a phone, pushed above whatever opened it: the chats (a
 * terminal row) or a chat (its header's Terminal). Keyed by the pane, so
 * another pane is another shell, never this one re-pointed.
 *
 * On iPad the terminal is the detail beside the chats (`openTerminal`), so a
 * link here hands over to that, as `chat/[workspaceId]` does, rather than
 * opening a second shell above the root.
 */
export default function TerminalRoute() {
  const params = useLocalSearchParams<Partial<Record<keyof TerminalRouteParams, string>>>();
  const router = useRouter();
  const hydrated = useConnections((state) => state.hydrated);
  const tablet = Platform.OS === 'ios' && Platform.isPad;
  const connectionId = params.connectionId ?? '';
  const paneId = params.paneId ?? '';
  const terminalId = terminalIdParam(params.terminalId);
  const kind = params.kind === 'agent' || params.kind === 'login' ? params.kind : 'shell';
  const title = params.title !== undefined && params.title !== '' ? params.title : 'Terminal';
  useFocusEffect(useCallback(() => {
    // A login shell (the Terminal tab's) is no pane of the chats, so it is not handed to their split.
    if (tablet && hydrated && kind !== 'login') openTerminal({ connectionId, paneId, kind, terminalId: terminalId ?? '', title });
  }, [tablet, hydrated, connectionId, paneId, kind, terminalId, title]));
  if (tablet && kind !== 'login') return null;
  return (
    <TerminalScreen
      key={`${connectionId}:${paneId}:${terminalId ?? ''}`}
      connectionId={connectionId}
      paneId={paneId}
      kind={kind}
      terminalId={terminalId}
      title={title}
      onBack={() => router.back()}
    />
  );
}
