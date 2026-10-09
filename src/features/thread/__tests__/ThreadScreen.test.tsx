import { fireEvent, render, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { View as MockView, type ViewProps } from 'react-native';

import ThreadScreen from '../ThreadScreen';

const mockReload = jest.fn(() => Promise.resolve());
const mockClearError = jest.fn();
const mockList = jest.fn((props: {
  data: unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactElement;
}) => props.renderItem({ item: props.data[0], index: 0 }));
let mockLoading = true;
let mockSessionMeta = { model: 'claude-opus-4-6', effort: null as string | null };
jest.mock('@shopify/flash-list', () => ({ FlashList: (props: Parameters<typeof mockList>[0]) => mockList(props) }));
jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('expo-router', () => ({ useRouter: () => ({}), useFocusEffect: jest.fn() }));
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({}) }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: ViewProps) => <MockView {...props} />,
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));
jest.mock('@/components/Glass', () => ({
  Glass: (props: ViewProps) => <MockView {...props} />,
  EdgeFade: () => null,
  useGlassAvailable: () => false,
}));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/state/connections', () => ({
  useConnections: () => false,
  useSelectedConnection: () => null,
}));
let mockWorkspaceLabel: string | null = null;
let mockSessionTitle: string | null = null;
let mockAgentName: string | null = null;
let mockOffline = false;
let mockPaused = false;
let mockAgents: { agent: string | null; paneId: string; agentSession: null }[] = [];
jest.mock('@/features/thread/useThread', () => ({
  useThread: () => ({
    agents: mockAgents,
    workspaceLabel: mockWorkspaceLabel,
    sessionTitle: mockSessionTitle,
    agentName: mockAgentName,
    offline: mockOffline,
    paused: mockPaused,
    messages: [{ id: 'm1', role: 'assistant', segments: [{ kind: 'text', text: 'Hello' }], timestamp: null, agentLabel: null, isSidechain: false }],
    sessionMeta: mockSessionMeta,
    workingDirName: 'project-with-a-long-folder-name', status: 'idle',
    isBlocked: false, overlay: null, overlayBusy: false, sendOverlayKeys: jest.fn(), isSending: false, canSend: true, loading: mockLoading,
    reachedStart: true, failedIds: new Set(),
    sessionState: 'ok', error: 'Conversation updates paused. Reconnecting.',
    reload: mockReload, clearError: mockClearError,
  }),
}));

it('extends header material to the window edge, insets only controls, and reserves measured clearance', async () => {
  const onBack = jest.fn();
  const screen = await render(<ThreadScreen workspaceId="w1" title="A long conversation title" onBack={onBack} />);
  const header = within(screen.getByTestId('thread-header'));
  expect(header.getByTestId('thread-title')).toHaveTextContent('A long conversation title');
  expect(header.getByTestId('thread-meta')).toHaveProp('numberOfLines', 1);
  expect(header.getByTestId('error-banner')).toHaveTextContent('Conversation updates paused. Reconnecting.');
  expect(screen.getAllByTestId('error-banner')).toHaveLength(1);
  expect(within(screen.getByTestId('thread-header')).getByTestId('thread-title')).toBeTruthy();
  expect(screen.getByTestId('thread-header-safe-area')).toHaveProp('edges', ['top', 'left', 'right']);
  expect(screen.getByTestId('thread-header-overlay')).toHaveStyle({ position: 'absolute', top: 0, left: 0, right: 0 });
  expect(screen.getByTestId('screen-content').props.style.maxWidth).toBeUndefined();
  expect(screen.getByText('Loading the conversation…').parent?.parent).toHaveStyle({ paddingTop: 139 });
  await fireEvent(screen.getByTestId('thread-header-overlay'), 'layout', { nativeEvent: { layout: { height: 140 } } });
  expect(screen.getByText('Loading the conversation…').parent?.parent).toHaveStyle({ paddingTop: 140 });
  await fireEvent.press(header.getByRole('button', { name: 'Dismiss' }));
  expect(mockClearError).toHaveBeenCalledTimes(1);
  await fireEvent.press(header.getByTestId('thread-reload'));
  expect(mockReload).toHaveBeenCalledTimes(1);
  await fireEvent.press(header.getByTestId('thread-back'));
  expect(onBack).toHaveBeenCalledTimes(1);
  mockLoading = false;
  await screen.rerender(<ThreadScreen workspaceId="w1" title="A long conversation title" />);
  expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({
    ListHeaderComponentStyle: { height: 140 },
    scrollIndicatorInsets: { top: 140 },
  }));
  // The mock renders only a data row, not ListHeaderComponent: this label must
  // follow the first bubble when short histories are bottom-aligned.
  expect(screen.getByText('Beginning of conversation')).toBeOnTheScreen();
  expect(screen.queryByTestId('thread-back')).toBeNull();
  expect(screen.getByTestId('composer-input')).toBeOnTheScreen();
  mockSessionMeta = { model: 'gpt-5.6', effort: 'high' };
  await screen.rerender(<ThreadScreen workspaceId="w1" title="Codex conversation" />);
  expect(screen.getByTestId('thread-meta')).toHaveTextContent('gpt-5.6 · high effort · project-with-a-long-folder-name · online');
});

it('names the chat from the host, never by its id, and keeps a draft after leaving (#113)', async () => {
  mockLoading = false;
  mockWorkspaceLabel = null;
  const screen = await render(<ThreadScreen workspaceId="w9" />);
  expect(screen.getByTestId('thread-title')).toHaveTextContent('Chat');
  mockWorkspaceLabel = 'Parser refactor';
  await screen.rerender(<ThreadScreen workspaceId="w9" title="Old name" />);
  expect(screen.getByTestId('thread-title')).toHaveTextContent('Parser refactor');
  await fireEvent.changeText(screen.getByTestId('composer-input'), 'half a thought');
  await screen.unmount();
  const again = await render(<ThreadScreen workspaceId="w9" />);
  expect(again.getByTestId('composer-input')).toHaveProp('value', 'half a thought');
  const other = await render(<ThreadScreen workspaceId="w10" />);
  expect(other.getAllByTestId('composer-input').at(-1)).toHaveProp('value', '');
});

// The header said "online" under a banner saying the chat was offline or paused.
it.each([
  [{ offline: true, paused: false }, 'offline'],
  [{ offline: false, paused: true }, 'reconnecting'],
])('says %j in the header rather than online', async (state, word) => {
  mockLoading = false;
  mockOffline = state.offline;
  mockPaused = state.paused;
  const screen = await render(<ThreadScreen workspaceId="w1" title="Chat" />);
  expect(screen.getByTestId('thread-meta')).toHaveTextContent(new RegExp(`· ${word}$`));
  mockOffline = false;
  mockPaused = false;
});

// A workspace with several agents gives each its own chat. They share the
// workspace's title, so the header has to say which agent this one is.
it('names the agent of a pane chat in its header, and keeps its draft apart from the workspace chat', async () => {
  mockLoading = false;
  mockWorkspaceLabel = 'api';
  mockSessionMeta = { model: 'claude-opus-4-6', effort: null };
  mockAgents = [{ agent: 'codex', paneId: 'w6:p2', agentSession: null }];
  const pane = await render(<ThreadScreen workspaceId="w6" paneId="w6:p2" />);
  expect(pane.getByTestId('thread-title')).toHaveTextContent('api');
  expect(pane.getByTestId('thread-meta')).toHaveTextContent(/^Codex · /);
  await fireEvent.changeText(pane.getByTestId('composer-input'), 'only for the second agent');
  await pane.unmount();
  const workspace = await render(<ThreadScreen workspaceId="w6" />);
  expect(workspace.getByTestId('thread-meta')).not.toHaveTextContent(/^Codex/);
  expect(workspace.getByTestId('composer-input')).toHaveProp('value', '');
  await workspace.unmount();
  const again = await render(<ThreadScreen workspaceId="w6" paneId="w6:p2" />);
  expect(again.getByTestId('composer-input')).toHaveProp('value', 'only for the second agent');
  mockAgents = [];
  mockWorkspaceLabel = null;
});

// A chat is titled by its session, as its row is. What the host says now wins
// over what the link carried; the link's title only bridges the first poll.
it('titles the chat by its session once the poll has one, the link before, and Chat with neither', async () => {
  mockLoading = false;
  mockAgents = [];
  mockWorkspaceLabel = null;
  mockSessionTitle = null;
  const screen = await render(<ThreadScreen workspaceId="w2" />);
  expect(screen.getByTestId('thread-title')).toHaveTextContent('Chat');
  await screen.rerender(<ThreadScreen workspaceId="w2" title="Release notes summary" />);
  expect(screen.getByTestId('thread-title')).toHaveTextContent('Release notes summary');
  // The first poll: the session retitled itself since the link was made.
  mockWorkspaceLabel = 'notes';
  mockSessionTitle = 'Release notes, three bullets';
  await screen.rerender(<ThreadScreen workspaceId="w2" title="Release notes summary" />);
  expect(screen.getByTestId('thread-title')).toHaveTextContent('Release notes, three bullets');
  // The workspace label, no longer the title, leads the line under it.
  expect(screen.getByTestId('thread-meta')).toHaveTextContent(/^notes · /);
  // The herdr name before the session has a title, then the label alone.
  mockSessionTitle = null;
  mockAgentName = 'notes-pm';
  await screen.rerender(<ThreadScreen workspaceId="w2" title="Release notes summary" />);
  expect(screen.getByTestId('thread-title')).toHaveTextContent('notes-pm');
  mockAgentName = null;
  await screen.rerender(<ThreadScreen workspaceId="w2" title="Release notes summary" />);
  expect(screen.getByTestId('thread-title')).toHaveTextContent('notes');
  expect(screen.getByTestId('thread-meta')).not.toHaveTextContent(/^notes · /);
  await screen.unmount();
});

it('leads a titled pane chat\'s line with its workspace, then its agent', async () => {
  mockLoading = false;
  mockWorkspaceLabel = 'api';
  mockSessionTitle = 'Web build';
  mockSessionMeta = { model: 'claude-opus-4-6', effort: 'high' };
  mockAgents = [{ agent: 'claude', paneId: 'w6:p2', agentSession: null }];
  const screen = await render(<ThreadScreen workspaceId="w6" paneId="w6:p2" title="api" />);
  expect(screen.getByTestId('thread-title')).toHaveTextContent('Web build');
  expect(screen.getByTestId('thread-meta')).toHaveTextContent(/^api · Claude · .*high effort/);
  await screen.unmount();
  mockSessionTitle = null;
  mockAgents = [];
});
