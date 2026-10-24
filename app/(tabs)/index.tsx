import { AdaptiveColumns, useSplitLayout } from '@/components/AdaptiveColumns';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import ChatsList from '@/features/chats/ChatsList';
import { useShownDetail } from '@/features/chats/useShownDetail';
import { usePendingPaneOpen } from '@/features/spaces/usePendingPaneOpen';
import { terminalBackControl } from '@/features/terminal/backControl';
import TerminalScreen from '@/features/terminal/TerminalScreen';
import ThreadScreen from '@/features/thread/ThreadScreen';
import { useWelcomeGate } from '@/features/welcome/useWelcomeGate';
import { chatOf, terminalOf, useChatSelection } from '@/state/chatSelection';

/**
 * The app's root: the chats, and on iPad or an iPhone Duo the open detail
 * beside them, a conversation or a pane's terminal; in their place when the
 * window is narrow or the Duo is folded.
 *
 * The first tab, beside Computers. Hosts and Settings are presented
 * above it from its header, and it is the screen the app opens on, which is
 * why the welcome gate runs here.
 */
export default function ChatsScreen() {
  useWelcomeGate();
  // A pane picked in the phone's layout sheet, opened on this screen's next focus.
  usePendingPaneOpen();
  const wide = useSplitLayout();
  const select = useChatSelection((state) => state.select);
  const shown = useShownDetail();
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
