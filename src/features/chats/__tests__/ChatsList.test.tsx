import { fireEvent, render, within } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { View as MockView, type ViewProps } from 'react-native';

import { HerdrClient } from '@/lib/herdr/client';
import { DemoHost } from '@/lib/demo/host';
import { useSpaceLayoutSheet } from '@/state/spaceLayout';
import ChatsList from '../ChatsList';
import { listChats, type ListedChat } from '../listedChat';
import { buildSummaries } from '../useWorkspaces';

// Every row drawn, in order: the list's own virtualisation is not under test.
jest.mock('@shopify/flash-list', () => ({
  FlashList: ({ data, renderItem, keyExtractor }: {
    data: unknown[];
    renderItem: (info: { item: unknown; index: number }) => ReactElement;
    keyExtractor: (item: unknown) => string;
  }) => {
    const { Fragment: MockFragment } = jest.requireActual<typeof import('react')>('react');
    return data.map((item, index) => <MockFragment key={keyExtractor(item)}>{renderItem({ item, index })}</MockFragment>);
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
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({}) }));
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
jest.mock('@/state/hostMachines', () => ({ refreshHostMachines: async () => true }));
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
jest.mock('../useHostChats', () => ({
  useHostChats: () => ({
    summaries: mockSummaries, loading: false, error: null, errorCode: null, refresh: async () => undefined,
    notices: [], connectionIds: ['demo'], targetOf: () => null,
  }),
}));
jest.mock('../useChatPrefs', () => ({
  useChatPrefs: () => ({
    pinnedAt: new Map(), isPinned: () => false, isMuted: () => false, canMute: () => false,
    togglePin: jest.fn(), toggleMute: jest.fn(), error: null, clearError: jest.fn(),
  }),
}));
jest.mock('../useOutdatedIntegrations', () => ({ useOutdatedIntegrations: () => ({ outdated: [], updating: false, error: null, update: jest.fn() }) }));
jest.mock('../useAttentionBadge', () => ({ useAttentionBadge: () => undefined }));
jest.mock('../useChatActions', () => ({
  useChatActions: () => ({ error: null, clearError: jest.fn(), manageChat: jest.fn(), renameChat: jest.fn(), closeChat: jest.fn() }),
}));
jest.mock('../MachineChats', () => ({ MachineFeeds: () => null }));

beforeAll(async () => {
  const snapshot = await new HerdrClient(new DemoHost()).snapshot();
  mockSummaries = listChats(
    buildSummaries(snapshot.workspaces ?? [], snapshot.agents, new Map(), [], snapshot.panes, new Map(), snapshot),
    'demo', null
  );
});
beforeEach(() => {
  mockPush.mockClear();
  mockTerminalAvailable = true;
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

// Android has no terminal: its rows would only open the screen saying so.
it('lists no terminal rows where no terminal can open', async () => {
  mockTerminalAvailable = false;
  const screen = await render(<ChatsList />);
  expect(screen.queryAllByTestId(/^terminal-row-/)).toEqual([]);
  expect(screen.getByTestId('pane-row-w6:p1')).toBeOnTheScreen();
  expect(screen.getByTestId('pane-row-w6:p2')).toBeOnTheScreen();
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
