import { Platform } from 'react-native';

import { AdaptiveColumns, useTabletLayout } from '@/components/AdaptiveColumns';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import ChatsList from '@/features/chats/ChatsList';
import { usePendingPaneOpen } from '@/features/spaces/usePendingPaneOpen';
import { terminalBackControl } from '@/features/terminal/backControl';
import TerminalScreen from '@/features/terminal/TerminalScreen';
import ThreadScreen from '@/features/thread/ThreadScreen';
import { useWelcomeGate } from '@/features/welcome/useWelcomeGate';
import { useSelectedConnection } from '@/state/connections';
import { chatOf, terminalOf, useChatSelection } from '@/state/chatSelection';
import { useOtherHosts } from '@/features/chats/useHostChats';

/**
 * The app's root: the chats, and on iPad the open detail beside them, a
 * conversation or a pane's terminal.
 *
 * The first tab, beside Computers. Hosts and Settings are presented
 * above it from its header, and it is the screen the app opens on, which is
 * why the welcome gate runs here.
 */
export default function ChatsScreen() {
  useWelcomeGate();
  // A pane picked in the phone's layout sheet, opened on this screen's next focus.
  usePendingPaneOpen();
  const wide = useTabletLayout();
  const connection = useSelectedConnection();
  const detail = useChatSelection((state) => state.detail);
  const select = useChatSelection((state) => state.select);
  // Workspace ids are only unique on their host. Never carry a selection onto
  // a list that does not hold its host: one on any listed host stays.
  const others = useOtherHosts(connection?.id ?? null);
  const listed = connection !== null && detail !== null &&
    (detail.connectionId === connection.id || others.some((other) => other.id === detail.connectionId));
  const shown = Platform.OS === 'ios' && Platform.isPad && listed ? detail : null;
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
          listedSig={chat.sig}
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
