import { Platform } from 'react-native';

import { AdaptiveColumns, useTabletLayout } from '@/components/AdaptiveColumns';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import ChatsList from '@/features/chats/ChatsList';
import { terminalBackControl } from '@/features/terminal/backControl';
import TerminalScreen from '@/features/terminal/TerminalScreen';
import ThreadScreen from '@/features/thread/ThreadScreen';
import { useWelcomeGate } from '@/features/welcome/useWelcomeGate';
import { useSelectedConnection } from '@/state/connections';
import { chatOf, terminalOf, useChatSelection } from '@/state/chatSelection';
import { isUnderHost } from '@/lib/herdr/machines';

/**
 * The app's root: the chats, and on iPad the open detail beside them, a
 * conversation or a pane's terminal.
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
  const detail = useChatSelection((state) => state.detail);
  const select = useChatSelection((state) => state.select);
  // Workspace ids are only unique on their host. Never carry a selection onto
  // another connection that happens to have the same workspace slot. A chat
  // or a pane on one of this host's machines is in this host's list, so it stays.
  const onThisHost = connection !== null && detail !== null &&
    (detail.connectionId === connection.id || isUnderHost(detail.connectionId, connection.id));
  const shown = Platform.OS === 'ios' && Platform.isPad && onThisHost ? detail : null;
  const chat = chatOf(shown);
  const terminal = terminalOf(shown);
  const selected = chat?.workspaceId;
  return (
    <AdaptiveColumns sidebar={
      <ChatsList
        selectedWorkspaceId={selected}
        selectedConnectionId={chat?.connectionId}
        selectedTerminal={terminal === null ? undefined : { connectionId: terminal.connectionId, paneId: terminal.paneId }}
      />
    }>
      {chat !== null ? (
        // Keyed by pane too, so moving between a workspace and one of its
        // agents remounts the thread instead of carrying one's state over.
        <ThreadScreen
          key={`${chat.connectionId}:${chat.workspaceId}:${chat.paneId ?? ''}`}
          connectionId={chat.connectionId}
          workspaceId={chat.workspaceId}
          paneId={chat.paneId}
          title={chat.title}
          onBack={wide ? undefined : () => select(null)}
        />
      ) : terminal !== null ? (
        // Keyed as the phone's route keys it: another pane is another shell,
        // and the old one hangs up as it unmounts. Back is where it came from,
        // the chat whose Terminal opened it or nothing, at any width. Beside
        // the chats it says which: a chat there has no back control at all.
        <TerminalScreen
          key={`terminal:${terminal.connectionId}:${terminal.paneId}:${terminal.terminalId ?? ''}`}
          connectionId={terminal.connectionId}
          paneId={terminal.paneId}
          kind={terminal.paneKind}
          terminalId={terminal.terminalId}
          title={terminal.title}
          back={terminalBackControl(wide, terminal.from)}
          onBack={() => select(terminal.from)}
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
