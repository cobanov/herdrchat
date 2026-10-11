import { act, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import ChatsList from '../ChatsList';
import type { ListedChat } from '../listedChat';
import type { Pane } from '@/lib/herdr/models';
import { useChatSelection } from '@/state/chatSelection';

/**
 * How the list picks the lit row on iPad, with everything around it stood in
 * for: the host's chats are canned (one workspace with a shell pane on the
 * host, one on a machine, both `w6:p3`), and the rows that are not terminals
 * are bare views that say whether they are selected.
 */

const mockOnClosed: { current: ((workspaceId: string, connectionId: string) => void) | undefined } = { current: undefined };

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
  useFocusEffect: () => {},
  router: { push: jest.fn(), dismissTo: jest.fn() },
}));
// One database, as the provider gives: a new object each render reloads the reads forever.
const mockDb = {};
const mockClient = {};
// Stable as the real hook's: new pins each render would rebuild every row,
// and hide a highlight that only `extraData` can repaint.
const mockPrefs = {
  pinnedAt: new Map(), isPinned: () => false, isMuted: () => false, canMute: () => false,
  togglePin: () => {}, toggleMute: () => {}, error: null, clearError: () => {},
};
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/components/Header', () => ({ Header: () => null }));
jest.mock('@/components/EmptyState', () => ({ EmptyState: () => null }));
jest.mock('@/components/ErrorBanner', () => ({ ErrorBanner: () => null }));
jest.mock('@/components/ActionSheet', () => ({ confirmDestructive: jest.fn(), showActionSheet: jest.fn() }));
jest.mock('@/features/chats/SkeletonRows', () => ({ SkeletonRows: () => null }));
jest.mock('@/features/chats/SwipeHint', () => ({ SwipeHint: () => null }));
jest.mock('@/features/welcome/StarCard', () => ({ StarCard: () => null }));
jest.mock('@/features/chats/HostKeyChangedBanner', () => ({ HostKeyChangedBanner: () => null }));
jest.mock('@/features/chats/IntegrationBanner', () => ({ IntegrationBanner: () => null }));
jest.mock('@/features/chats/MachineNotices', () => ({ MachineNotices: () => null }));
jest.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/state/connections', () => ({
  useSelectedConnection: () => ({ id: 'host-a', name: 'host-a', host: 'host-a', username: 'me' }),
  clientFor: () => mockClient,
  isDemo: () => false,
  loadHostKeyPin: () => Promise.resolve(null),
  newConnection: () => ({ id: 'new' }),
}));
jest.mock('@/state/db', () => ({ loadThreadReads: () => Promise.resolve(new Map()), setSetting: jest.fn() }));
jest.mock('@/features/chats/useHostChats', () => ({ useHostChats: () => mockChats }));
jest.mock('@/features/chats/useOutdatedIntegrations', () => ({
  useOutdatedIntegrations: () => ({ outdated: [], updating: false, error: null, update: jest.fn() }),
}));
jest.mock('@/features/chats/useChatPrefs', () => ({
  useChatPrefs: () => mockPrefs,
}));
jest.mock('@/features/chats/useChatActions', () => ({
  useChatActions: ({ onClosed }: { onClosed?: (workspaceId: string, connectionId: string) => void }) => {
    mockOnClosed.current = onClosed;
    return { error: null, clearError: jest.fn(), renameChat: jest.fn(), closeChat: jest.fn(), manageChat: jest.fn() };
  },
}));
jest.mock('@/features/chats/useAttentionBadge', () => ({ useAttentionBadge: () => {} }));
jest.mock('@/features/chats/MachineChats', () => ({ MachineFeeds: () => null }));
jest.mock('@/features/chats/SwipeableChatRow', () => ({
  SwipeableChatRow: ({ summary, selected }: { summary: ListedChat; selected: boolean }) => {
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return <View testID={`chat-row-${summary.connectionId}-${summary.workspaceId}`} accessibilityState={{ selected }} />;
  },
}));
jest.mock('../PaneRow', () => ({
  PaneRow: ({ summary, pane, selected }: { summary: ListedChat; pane: { paneId: string }; selected: boolean }) => {
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return <View testID={`pane-row-${summary.connectionId}-${pane.paneId}`} accessibilityState={{ selected }} />;
  },
}));
interface MockListProps {
  data: unknown[];
  extraData: unknown;
  keyExtractor: (item: unknown) => string;
  renderItem: (info: { item: unknown }) => ReactElement;
}
// FlashList repaints a row only when its item or `extraData` changes; the
// stand-in does the same, so a highlight missing from `extraData` stays dark.
jest.mock('@shopify/flash-list', () => {
  const { memo } = jest.requireActual<typeof import('react')>('react');
  const Row = memo(
    ({ item, render }: { item: unknown; extra: unknown; render: (info: { item: unknown }) => ReactElement }) => render({ item }),
    (a, b) => a.item === b.item && a.extra === b.extra,
  );
  return {
    FlashList: ({ data, extraData, keyExtractor, renderItem }: MockListProps) =>
      data.map((item) => <Row key={keyExtractor(item)} item={item} extra={extraData} render={renderItem} />),
  };
});

const pane = (paneId: string) =>
  ({ paneId, workspaceId: 'w6', tabId: 't1', agent: null, cwd: '/home/demo/api', foregroundCwd: null, focused: false, title: null }) as unknown as Pane;
const agentPane = (paneId: string, connectionId: string) =>
  ({
    paneId, connectionId, machine: null, status: 'idle', sessionSig: null, preview: null, sessionTitle: null, agentName: 'claude',
    agent: { name: 'claude', paneId, status: 'idle' },
  }) as unknown as ListedChat['panes'][number];
function workspace(connectionId: string, machine: ListedChat['machine'], panes: ListedChat['panes']): ListedChat {
  return {
    connectionId, machine, workspaceId: 'w6', title: 'api', number: 6, status: 'idle', agents: [], panes,
    preview: null, sessionSig: null, restoreError: null, sessionTitle: null, agentName: null,
    shellPanes: [{ paneId: 'w6:p3', pane: pane('w6:p3'), processName: 'vim' }],
  };
}
const onHost = workspace('host-a', null, [agentPane('w6:p1', 'host-a'), agentPane('w6:p2', 'host-a')]);
const onNuku = workspace('host-a/nuku', { id: 'nuku', label: 'nuku' }, []);
const mockChats = {
  summaries: [onHost, onNuku],
  loading: false, error: null, errorCode: null, refresh: jest.fn(() => Promise.resolve()), notices: [],
  connectionIds: ['host-a', 'host-a/nuku'], targetOf: () => null,
};

const selectedOf = (screen: Awaited<ReturnType<typeof render>>, testID: string) =>
  (screen.getByTestId(testID).props as { accessibilityState?: { selected?: boolean } }).accessibilityState?.selected === true;
const everyRow = ['chat-row-host-a-w6', 'chat-row-host-a/nuku-w6', 'pane-row-host-a-w6:p1', 'pane-row-host-a-w6:p2', 'terminal-row-w6:p3', 'terminal-row-nuku-w6:p3'];
const lit = (screen: Awaited<ReturnType<typeof render>>) => everyRow.filter((id) => selectedOf(screen, id));

beforeEach(() => useChatSelection.getState().select(null));

it('lights the open terminal\'s row by its own connection and pane, and no chat or card', async () => {
  const screen = await render(<ChatsList selectedTerminal={{ connectionId: 'host-a', paneId: 'w6:p3' }} />);
  expect(lit(screen)).toEqual(['terminal-row-w6:p3']);
});

it('lights the machine\'s row, not the host\'s with the same pane id, for a terminal on a machine', async () => {
  const screen = await render(<ChatsList selectedTerminal={{ connectionId: 'host-a/nuku', paneId: 'w6:p3' }} />);
  expect(lit(screen)).toEqual(['terminal-row-nuku-w6:p3']);
});

it('repaints as the detail moves between terminals and a chat', async () => {
  const screen = await render(<ChatsList selectedTerminal={{ connectionId: 'host-a', paneId: 'w6:p3' }} />);
  // From one terminal to another no chat is open either side: only the
  // terminal in `extraData` repaints the two rows.
  await screen.rerender(<ChatsList selectedTerminal={{ connectionId: 'host-a/nuku', paneId: 'w6:p3' }} />);
  expect(lit(screen)).toEqual(['terminal-row-nuku-w6:p3']);
  await screen.rerender(<ChatsList selectedWorkspaceId="w6" selectedConnectionId="host-a" />);
  expect(lit(screen)).toEqual(['chat-row-host-a-w6']);
  await screen.rerender(<ChatsList selectedTerminal={{ connectionId: 'host-a/nuku', paneId: 'w6:p3' }} />);
  expect(lit(screen)).toEqual(['terminal-row-nuku-w6:p3']);
});

it('closing a workspace drops a terminal on one of its panes, and only on that connection', async () => {
  const terminal = { connectionId: 'host-a', paneId: 'w6:p3', terminalId: null, paneKind: 'shell' as const, title: 'vim', from: null };
  useChatSelection.getState().showTerminal(terminal);
  await render(<ChatsList selectedTerminal={{ connectionId: 'host-a', paneId: 'w6:p3' }} />);
  await act(() => mockOnClosed.current?.('w6', 'host-a/nuku'));
  expect(useChatSelection.getState().detail).toEqual({ kind: 'terminal', ...terminal });
  await act(() => mockOnClosed.current?.('w6', 'host-a'));
  expect(useChatSelection.getState().detail).toBeNull();
});
