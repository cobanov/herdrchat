import { Platform } from 'react-native';

import { AdaptiveColumns, useTabletLayout } from '@/components/AdaptiveColumns';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import ChatsList from '@/features/chats/ChatsList';
import ThreadScreen from '@/features/thread/ThreadScreen';
import { useWelcomeGate } from '@/features/welcome/useWelcomeGate';
import { useSelectedConnection } from '@/state/connections';
import { useChatSelection } from '@/state/chatSelection';
import { isUnderHost } from '@/lib/herdr/machines';

/**
 * The app's root: the chats, and on iPad the open conversation beside them.
 *
 * Nothing else is a peer of this screen. Hosts and Settings are presented above
 * it from the menu in its header (see `src/lib/mainMenu.ts`), so this is also
 * the one screen that is always underneath, which is why the welcome gate runs
 * here.
 */
export default function ChatsScreen() {
  useWelcomeGate();
  const wide = useTabletLayout();
  const connection = useSelectedConnection();
  const selection = useChatSelection((state) => state.selection);
  const select = useChatSelection((state) => state.select);
  // Workspace ids are only unique on their host. Never carry a selection onto
  // another connection that happens to have the same workspace slot. A chat
  // on one of this host's machines is in this host's list, so it stays.
  const onThisHost = connection !== null && selection !== null &&
    (selection.connectionId === connection.id || isUnderHost(selection.connectionId, connection.id));
  const selected = Platform.OS === 'ios' && Platform.isPad && onThisHost ? selection?.workspaceId : undefined;
  return (
    <AdaptiveColumns sidebar={<ChatsList selectedWorkspaceId={selected} selectedConnectionId={selection?.connectionId} />}>
      {selected !== undefined ? (
        // Keyed by pane too, so moving between a workspace and one of its
        // agents remounts the thread instead of carrying one's state over.
        <ThreadScreen
          key={`${selection?.connectionId}:${selected}:${selection?.paneId ?? ''}`}
          connectionId={selection?.connectionId}
          workspaceId={selected}
          paneId={selection?.paneId}
          title={selection?.title}
          onBack={wide ? undefined : () => select(null)}
        />
      ) : wide ? (
        <Screen>
          <EmptyState
            symbol="bubble.left.and.bubble.right"
            title="Select a conversation"
            body="Choose a chat on the left, or start a new one."
          />
        </Screen>
      ) : <ChatsList />}
    </AdaptiveColumns>
  );
}
