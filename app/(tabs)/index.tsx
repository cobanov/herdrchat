import { Platform } from 'react-native';

import { AdaptiveColumns, useTabletLayout } from '@/components/AdaptiveColumns';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import ChatsList from '@/features/chats/ChatsList';
import ThreadScreen from '@/features/thread/ThreadScreen';
import { useSelectedConnection } from '@/state/connections';
import { useChatSelection } from '@/state/chatSelection';

export default function ChatsScreen() {
  const wide = useTabletLayout();
  const connection = useSelectedConnection();
  const selection = useChatSelection((state) => state.selection);
  const select = useChatSelection((state) => state.select);
  // Workspace ids are only unique on their host. Never carry a selection onto
  // another connection that happens to have the same workspace slot.
  const selected = Platform.OS === 'ios' && Platform.isPad && selection?.connectionId === connection?.id
    ? selection?.workspaceId : undefined;
  return (
    <AdaptiveColumns sidebar={<ChatsList selectedWorkspaceId={selected} />}>
      {selected !== undefined ? (
        <ThreadScreen
          key={`${connection?.id}:${selected}`}
          workspaceId={selected}
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
