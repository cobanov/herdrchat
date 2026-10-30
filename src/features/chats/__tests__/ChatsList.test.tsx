import { act, fireEvent, render, within } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { Platform, View as MockView, type ViewProps } from 'react-native';

import { HerdrClient } from '@/lib/herdr/client';
import { DemoHost } from '@/lib/demo/host';
import { useChatSelection } from '@/state/chatSelection';
import { useSpaceLayoutSheet } from '@/state/spaceLayout';
import ChatsList from '../ChatsList';
import { listChats, type ListedChat } from '../listedChat';
import { buildSummaries } from '../useWorkspaces';
import { motion } from '@/theme/tokens';

// Every row drawn, in order: the list's own virtualisation is not under test.
jest.mock('@shopify/flash-list', () => ({
  FlashList: ({ data, renderItem, keyExtractor, ListFooterComponent }: {
    data: unknown[];
    renderItem: (info: { item: unknown; index: number }) => ReactElement;
    keyExtractor: (item: unknown) => string;
    ListFooterComponent?: ReactElement;
  }) => {
    const { Fragment: MockFragment } = jest.requireActual<typeof import('react')>('react');
    return [
      ...data.map((item, index) => <MockFragment key={keyExtractor(item)}>{renderItem({ item, index })}</MockFragment>),
      <MockFragment key="footer">{ListFooterComponent}</MockFragment>,
    ];
  },
  useRecyclingState: () => [false, jest.fn()],
}));
jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => children,
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, navigate: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), dismissTo: jest.fn() },
}));
// One database for every render, as the real context gives: a new object
// each time re-ran the list's read-marker effect forever once a chat was open.
const mockDb = {};
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: ViewProps) => <MockView {...props} />,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: jest.requireActual('@/theme/tokens').darkPalette,
    avatarPalette: jest.requireActual('@/theme/tokens').avatarPalette,
    reduceMotion: true,
  }),
}));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/components/Header', () => ({ Header: () => null }));
jest.mock('@/components/Glass', () => ({ Glass: (props: ViewProps) => <MockView {...props} /> }));
jest.mock('@/features/usePollGate', () => ({ usePollGate: () => true }));
jest.mock('@/features/useHostEvents', () => ({ useHostEvents: () => false }));
jest.mock('@/state/hostTheme', () => ({ checkHostTheme: async () => true }));
jest.mock('@/state/slashCommands', () => ({ scanSlashCatalogue: async () => undefined }));
jest.mock('@/state/connections', () => ({
  useSelectedConnection: () => ({ id: 'demo', name: 'Demo', host: 'demo', username: 'demo' }),
  clientFor: () => null,
  isDemo: () => true,
  loadHostKeyPin: async () => null,
  newConnection: () => ({ id: 'new' }),
}));
// Jest has no native terminal view, so `isTerminalAvailable` is false
// unless a test says otherwise: the Spaces terminal rows need it true.
let mockTerminalAvailable = true;
jest.mock('../../../../modules/herdr-terminal/src', () => ({
  get isTerminalAvailable() {
    return mockTerminalAvailable;
  },
}));
jest.mock('@/state/db', () => ({ loadThreadReads: async () => new Map(), setSetting: async () => undefined }));
jest.mock('@/state/saveSetting', () => ({ saveSetting: jest.fn() }));
const mockSettings = { listMode: 'spaces', seenSwipeHint: true, starAsked: true, activeDays: '', pollScale: 1 };
jest.mock('@/state/settings', () => ({
  useSettings: Object.assign((select: (state: typeof mockSettings) => unknown) => select(mockSettings), { getState: () => mockSettings }),
  encodeBool: (value: boolean) => String(value),
}));
let mockSummaries: ListedChat[] = [];
let mockListError: string | null = null;
jest.mock('../useHostChats', () => ({
  useHostChats: () => ({
    summaries: mockSummaries, loading: false, error: mockListError, errorCode: null, refresh: async () => undefined,
    notices: [], connectionIds: ['demo'], targetOf: () => null,
  }),
}));
/** Workspaces pinned in a test, by id. */
let mockPinned: readonly string[] = [];
jest.mock('../useChatPrefs', () => ({
  useChatPrefs: () => ({
    pinnedAt: new Map(), isPinned: (chat: { workspaceId: string }) => mockPinned.includes(chat.workspaceId),
    isMuted: () => false, canMute: () => false,
    togglePin: jest.fn(), toggleMute: jest.fn(), error: null, clearError: jest.fn(),
  }),
}));
jest.mock('../useOutdatedIntegrations', () => ({ useOutdatedIntegrations: () => ({ issues: [], updating: false, error: null, update: jest.fn() }) }));
jest.mock('../useAttentionBadge', () => ({ useAttentionBadge: () => undefined }));
const mockManage = jest.fn();
jest.mock('../useChatActions', () => ({
  useChatActions: () => ({
    error: null, clearError: jest.fn(), manageChat: (...args: unknown[]) => mockManage(...args), renameChat: jest.fn(), closeChat: jest.fn(),
  }),
}));
jest.mock('../HostFeeds', () => ({ HostFeeds: () => null }));
// Its own reads are UsageFooter.test's; here only whether the list draws it.
jest.mock('../UsageFooter', () => ({ UsageFooter: () => <MockView testID="usage-footer" /> }));
const mockOpenChat = jest.fn();
jest.mock('../navigation', () => ({ openChat: (...args: unknown[]) => mockOpenChat(...args) }));

beforeAll(async () => {
  const snapshot = await new HerdrClient(new DemoHost()).snapshot();
  mockSummaries = listChats(
    buildSummaries(snapshot.workspaces ?? [], snapshot.agents, new Map(), [], snapshot.panes, new Map(), snapshot),
    'demo', null
  );
});
beforeEach(() => {
  mockPush.mockClear();
  mockOpenChat.mockClear();
  mockPinned = [];
  mockTerminalAvailable = true;
  mockListError = null;
  useChatSelection.setState({ detail: null });
});

// The footer reads its host every few seconds. Under a host whose poll had
// stopped (a changed key, a failed login) it kept asking, and reconnecting.
it('draws the Claude usage footer under the rows, but not while the host is failing', async () => {
  const screen = await render(<ChatsList />);
  expect(screen.getByTestId('usage-footer')).toBeOnTheScreen();
  mockListError = 'The host key changed.';
  await screen.rerender(<ChatsList />);
  expect(screen.getByTestId('chat-row-w6')).toBeOnTheScreen();
  expect(screen.queryByTestId('usage-footer')).toBeNull();
});

// "Each top level card doesn't represent an agent, it should just list the
// workspace name, some stats, and a button to see the layout."
it("draws w6 as the workspace, its agents and terminals under it", async () => {
  const screen = await render(<ChatsList />);
  const card = screen.getByTestId('chat-row-w6');
  expect(card).toHaveProp('accessibilityLabel', expect.stringMatching(/^api, 2 agents, 1 working · 2 tabs · 4 panes · demo\/api/));
  expect(within(card).getByText('api')).toBeOnTheScreen();
  expect(screen.getByTestId('space-layout-w6')).toHaveProp('accessibilityLabel', 'Show layout');
  expect(screen.getByTestId('pane-row-w6:p1')).toBeOnTheScreen();
  expect(screen.getByTestId('pane-row-w6:p2')).toBeOnTheScreen();
  expect(screen.getByTestId('terminal-row-w6:p3')).toBeOnTheScreen();
  expect(screen.getByTestId('terminal-row-w6:p4')).toBeOnTheScreen();
});

// Split terminal goes beside the agent pressed: w6's second agent, not its first.
it("hands an agent row's own pane to its long-press menu", async () => {
  const screen = await render(<ChatsList />);
  await fireEvent(screen.getByTestId('pane-row-w6:p2'), 'longPress');
  expect(mockManage).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: 'w6' }), expect.any(Array), 'w6:p2');
});

// Android has no terminal: a shell's row would only open the screen saying
// so. Without those, w6's agents share one tab, so there is nothing to divide.
// The opencode agent keeps its row, or it would be in no list at all.
it('lists only agents as terminal rows where no terminal can open', async () => {
  mockTerminalAvailable = false;
  const screen = await render(<ChatsList />);
  expect(screen.queryAllByTestId(/^terminal-row-/).map((row) => row.props.testID)).toEqual(['terminal-row-w9:p1']);
  expect(screen.getByTestId('pane-row-w6:p1')).toBeOnTheScreen();
  expect(screen.getByTestId('pane-row-w6:p2')).toBeOnTheScreen();
  expect(screen.queryAllByTestId(/^tab-(header|divider)-w6:/)).toEqual([]);
});

// "When there are multiple tabs in a space, the space children list should be
// grouped by tab." w6's dev server is alone in its tab "server": it comes
// after the first tab's agents and shell, under a line and that name.
it("groups w6's rows by tab, with a line and the tab's name before the second", async () => {
  const screen = await render(<ChatsList />);
  const order = screen.getAllByTestId(/^(pane-row|terminal-row|tab-header|tab-divider)-w6:/).map((node) => node.props.testID as string);
  expect(order).toEqual([
    'tab-header-w6:t1', 'pane-row-w6:p1', 'pane-row-w6:p2', 'terminal-row-w6:p3',
    'tab-divider-w6:t2', 'tab-header-w6:t2', 'terminal-row-w6:p4',
  ]);
  expect(screen.getByTestId('tab-header-w6:t1')).toHaveTextContent('api');
  expect(screen.getByTestId('tab-header-w6:t2')).toHaveTextContent('server');
  expect(screen.queryByTestId('tab-divider-w6:t1')).toBeNull();
  // w7 is one tab: nothing to divide.
  expect(screen.queryAllByTestId(/^tab-(header|divider)-w7:/)).toEqual([]);
});

it('keeps a workspace of one agent and nothing else as that chat, with no layout button', async () => {
  const screen = await render(<ChatsList />);
  expect(screen.getByTestId('chat-row-w2')).toHaveProp('accessibilityLabel', expect.stringMatching(/^Release notes summary, /));
  expect(screen.queryByTestId('space-layout-w2')).toBeNull();
  expect(screen.queryByTestId('pane-row-w2:p1')).toBeNull();
});

// On a phone the layout is a sheet, opened from the card or its button.
it("opens w6's layout sheet from its button and from the card", async () => {
  const screen = await render(<ChatsList />);
  await fireEvent.press(screen.getByTestId('space-layout-w6'));
  expect(mockPush).toHaveBeenCalledWith('/space-layout');
  expect(useSpaceLayoutSheet.getState().summary?.workspaceId).toBe('w6');
  mockPush.mockClear();
  useSpaceLayoutSheet.setState({ summary: null });
  await fireEvent.press(screen.getByTestId('chat-row-w6'));
  expect(mockPush).toHaveBeenCalledWith('/space-layout');
  expect(useSpaceLayoutSheet.getState().summary?.workspaceId).toBe('w6');
});

// Kenneth's own case: one agent and a terminal. The card is the workspace,
// the agent a row under it (still the workspace's chat), then the terminal.
it('draws one agent beside a shell as a space, the agent and its terminal under it', async () => {
  const screen = await render(<ChatsList />);
  const card = screen.getByTestId('chat-row-w7');
  expect(card).toHaveProp('accessibilityLabel', expect.stringMatching(/^site, 1 agent · 1 tab · 2 panes · demo\/site/));
  expect(within(card).getByText('site')).toBeOnTheScreen();
  expect(screen.getByTestId('space-layout-w7')).toBeOnTheScreen();
  expect(screen.getByTestId('pane-row-w7:p1')).toHaveProp('accessibilityLabel', expect.stringMatching(/^Landing page copy, /));
  expect(screen.getByTestId('terminal-row-w7:p2')).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('pane-row-w7:p1'));
  // With the session the list saw, so the chat opens from its cache at once.
  expect(mockOpenChat).toHaveBeenCalledWith('demo', 'w7', 'Landing page copy', undefined, '88888888-8888-4888-8888-888888888888');
});

// The lone agent's row is the workspace chat, so it is the one lit while
// that chat is open, under the workspace's key.
it("highlights a lone agent's row while its workspace chat is open", async () => {
  useChatSelection.setState({ detail: { kind: 'chat', connectionId: 'demo', workspaceId: 'w7', title: 'Landing page copy' } });
  const screen = await render(<ChatsList selectedWorkspaceId="w7" selectedConnectionId="demo" />);
  expect(screen.getByTestId('pane-row-w7:p1')).toHaveProp('accessibilityState', { selected: true });
});

// Opened as its own pane chat while w7 held two agents; the other exited,
// and it is alone beside the shell. Its row is keyed `w7` now, and stays lit.
it("keeps a lone agent's row highlighted when it was opened as a pane chat", async () => {
  useChatSelection.setState({ detail: { kind: 'chat', connectionId: 'demo', workspaceId: 'w7', paneId: 'w7:p1', title: 'Landing page copy' } });
  const screen = await render(<ChatsList selectedWorkspaceId="w7" selectedConnectionId="demo" />);
  expect(screen.getByTestId('pane-row-w7:p1')).toHaveProp('accessibilityState', { selected: true });
  expect(screen.getByTestId('chat-row-w7')).not.toHaveProp('accessibilityState', { selected: true });
});

// The lone agent shares its workspace's pin: one pin, on the card.
it("draws a workspace's pin once, on its card, not again on its lone agent", async () => {
  mockPinned = ['w7'];
  const screen = await render(<ChatsList />);
  expect(screen.getByTestId('chat-row-w7')).toHaveProp('accessibilityLabel', expect.stringMatching(/^site, Pinned, /));
  expect(screen.getByTestId('pane-row-w7:p1')).toHaveProp('accessibilityLabel', expect.not.stringMatching(/Pinned/));
});

// An older herdr sends no tabs or layouts: no button that opens an empty view.
it('offers no layout button where herdr reports no layout', async () => {
  const before = mockSummaries;
  mockSummaries = mockSummaries.map((summary) => summary.workspaceId === 'w6' ? { ...summary, tabs: [], layouts: [] } : summary);
  try {
    const screen = await render(<ChatsList />);
    expect(screen.getByTestId('chat-row-w6')).toBeOnTheScreen();
    expect(screen.queryByTestId('space-layout-w6')).toBeNull();
    await fireEvent.press(screen.getByTestId('chat-row-w6'));
    expect(mockPush).not.toHaveBeenCalled();
  } finally {
    mockSummaries = before;
  }
});

// On iPad the layout is a floating card, not a sheet.
describe('on iPad', () => {
  // Jest runs as iOS; `isPad` is iOS's own field, which Platform's union type hides.
  const wasPad = Platform.OS === 'ios' ? Platform.isPad : false;
  // The mocked views measure nothing; the card needs its button and the list placed.
  const native = jest.requireActual<{ default: { measureInWindow: jest.Mock } }>('@react-native/jest-preset/jest/MockNativeMethods').default;
  beforeAll(() => {
    Object.defineProperty(Platform, 'isPad', { value: true, configurable: true });
    native.measureInWindow.mockImplementation((done: (x: number, y: number, width: number, height: number) => void) => done(0, 0, 320, 600));
  });
  afterAll(() => {
    Object.defineProperty(Platform, 'isPad', { value: wasPad, configurable: true });
    native.measureInWindow.mockReset();
  });

  it("shows w6's layout as a floating card from its button, pushing no sheet", async () => {
    const screen = await render(<ChatsList />);
    await fireEvent.press(screen.getByTestId('space-layout-w6'));
    expect(mockPush).not.toHaveBeenCalled();
    expect(await screen.findByTestId('space-layout-card')).toBeOnTheScreen();
    expect(screen.getByTestId('layout-w6')).toBeOnTheScreen();
    // Pinned by the tap: a tap anywhere outside closes it.
    await fireEvent.press(screen.getByTestId('space-layout-backdrop'));
    expect(screen.queryByTestId('space-layout-card')).toBeNull();
  });

  it('shows the card while a pointer rests on the button, and not after it leaves', async () => {
    jest.useFakeTimers();
    try {
      const screen = await render(<ChatsList />);
      const button = screen.getByTestId('space-layout-w6').parent!;
      await fireEvent(button, 'pointerEnter');
      expect(screen.queryByTestId('space-layout-card')).toBeNull();
      await act(() => jest.advanceTimersByTime(motion.hoverIn));
      expect(screen.getByTestId('space-layout-card')).toBeOnTheScreen();
      // Not pinned: nothing to tap outside.
      expect(screen.queryByTestId('space-layout-backdrop')).toBeNull();
      await fireEvent(button, 'pointerLeave');
      await act(() => jest.advanceTimersByTime(motion.hoverOut));
      expect(screen.queryByTestId('space-layout-card')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
