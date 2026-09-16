import { AdaptiveColumns, useTabletLayout } from '@/components/AdaptiveColumns';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import ChatsList from '@/features/chats/ChatsList';

export default function ChatsScreen() {
  const wide = useTabletLayout();
  return (
    <AdaptiveColumns sidebar={<ChatsList />}>
      {wide ? (
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
