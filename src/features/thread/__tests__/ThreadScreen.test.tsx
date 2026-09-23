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
  useGlassAvailable: () => false,
}));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/state/connections', () => ({
  useConnections: () => false,
  useSelectedConnection: () => null,
}));
jest.mock('@/features/thread/useThread', () => ({
  useThread: () => ({
    agents: [],
    messages: [{ id: 'm1', role: 'assistant', segments: [{ kind: 'text', text: 'Hello' }], timestamp: null, agentLabel: null, isSidechain: false }],
    sessionMeta: mockSessionMeta,
    workingDirName: 'project-with-a-long-folder-name', status: 'idle',
    isBlocked: false, isSending: false, canSend: true, loading: mockLoading,
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
  expect(screen.getByTestId('thread-header')).toHaveProp('edgeAttached', true);
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
  expect(screen.getByTestId('thread-meta')).toHaveTextContent('gpt-5.6 · high · project-with-a-long-folder-name · online');
});
