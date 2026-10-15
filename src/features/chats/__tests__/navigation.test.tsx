import { act, fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import * as Native from 'react-native';

import ChatsScreen from '../../../../app/index';
import ThreadRoute from '../../../../app/chat/[workspaceId]';
import { openChat } from '../navigation';
import { useChatSelection } from '@/state/chatSelection';

let mockConnectionId = 'host-a';
let mockHydrated = true;
const mockPush = jest.fn();
const mockDismissTo = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ workspaceId: 'w2', title: 'Notes' }),
  useRouter: () => ({ back: jest.fn() }),
  useFocusEffect: (effect: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  router: { push: (...args: unknown[]) => mockPush(...args), dismissTo: (...args: unknown[]) => mockDismissTo(...args) },
}));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: jest.fn(),
}));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: { systemBackground: '#000', separator: '#333' } }),
}));
jest.mock('@/state/connections', () => ({
  useSelectedConnection: () => ({ id: mockConnectionId }),
  useConnections: (selector: (state: { hydrated: boolean }) => unknown) => selector({ hydrated: mockHydrated }),
}));
jest.mock('@/features/welcome/useWelcomeGate', () => ({ useWelcomeGate: () => {} }));
jest.mock('@/features/chats/ChatsList', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/EmptyState', () => ({ EmptyState: () => null }));
jest.mock('@/features/terminal/TerminalScreen', () => ({ __esModule: true, default: () => null }));
jest.mock('@/features/thread/ThreadScreen', () => ({
  __esModule: true,
  default: (props: { workspaceId: string; onBack?: () => void }) => <MockThread {...props} />,
}));

function MockThread({ workspaceId, onBack }: { workspaceId: string; onBack?: () => void }) {
  const [draft, setDraft] = useState('');
  return <Native.View testID="thread" accessibilityLabel={workspaceId}>
    <Native.TextInput testID="draft" value={draft} onChangeText={setDraft} />
    {onBack && <Native.Button title="Back" onPress={onBack} />}
  </Native.View>;
}

const originalPad = Object.getOwnPropertyDescriptor(Native.Platform, 'isPad');
function windowAt(width: number, isPad = true) {
  Object.defineProperty(Native.Platform, 'isPad', { configurable: true, get: () => isPad });
  jest.mocked(Native.useWindowDimensions).mockReturnValue({ width, height: 1024, scale: 2, fontScale: 1 });
}
beforeEach(() => {
  windowAt(1032);
  useChatSelection.getState().select({ connectionId: 'host-a', workspaceId: 'w2', title: 'Notes' });
  mockConnectionId = 'host-a';
  mockHydrated = true;
  mockPush.mockClear();
  mockDismissTo.mockClear();
});
afterAll(() => {
  if (originalPad) Object.defineProperty(Native.Platform, 'isPad', originalPad);
});

it('uses the root chats screen for all iPad chat entry points, including narrow windows', () => {
  openChat('host-a', 'w2', 'Notes');
  expect(mockDismissTo).toHaveBeenCalledWith('/');
  expect(useChatSelection.getState().detail).toEqual({ kind: 'chat', connectionId: 'host-a', workspaceId: 'w2', title: 'Notes' });
  expect(mockPush).not.toHaveBeenCalled();
  windowAt(600);
  openChat('host-a', 'w3');
  expect(mockDismissTo).toHaveBeenCalledTimes(2);
  expect(mockPush).not.toHaveBeenCalled();
  windowAt(932, false);
  openChat('host-a', 'w2');
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/chat/[workspaceId]', params: { connectionId: 'host-a', workspaceId: 'w2', title: '' } });
});

// #154 review: a phone pushing the chat while Hosts or Settings was open put it
// under the sheet, so a notification tap looked like it did nothing until Done.
// The chats come to the top first, then the chat is pushed on them; the same
// call from the list, with no sheet, is a `dismissTo` the router keeps as is.
it('closes any sheet before pushing the chat on a phone', () => {
  windowAt(932, false);
  const order: string[] = [];
  mockDismissTo.mockImplementation((href: string) => order.push(`dismissTo ${href}`));
  mockPush.mockImplementation((href: { pathname: string }) => order.push(`push ${href.pathname}`));
  openChat('host-a', 'w4', 'Build');
  expect(order).toEqual(['dismissTo /', 'push /chat/[workspaceId]']);
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/chat/[workspaceId]', params: { connectionId: 'host-a', workspaceId: 'w4', title: 'Build' } });
  mockDismissTo.mockReset();
  mockPush.mockReset();
});

// One agent of a workspace is its own chat; opening it must say which.
it('carries the pane into the route on a phone and into the selection on iPad', () => {
  openChat('host-a', 'w6', 'api', 'w6:p2');
  expect(useChatSelection.getState().detail).toEqual({ kind: 'chat', connectionId: 'host-a', workspaceId: 'w6', title: 'api', paneId: 'w6:p2' });
  openChat('host-a', 'w6', 'api');
  expect(useChatSelection.getState().detail).toEqual({ kind: 'chat', connectionId: 'host-a', workspaceId: 'w6', title: 'api' });
  windowAt(932, false);
  openChat('host-a', 'w6', 'api', 'w6:p2');
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/chat/[workspaceId]', params: { connectionId: 'host-a', workspaceId: 'w6', title: 'api', paneId: 'w6:p2' },
  });
});

it('keeps the selected detail and draft mounted across width changes, with back only when compact', async () => {
  const screen = await render(<ChatsScreen />);
  expect(screen.getByTestId('tablet-sidebar')).toBeOnTheScreen();
  expect(screen.queryByText('Back')).toBeNull();
  await fireEvent.changeText(screen.getByTestId('draft'), 'Unsent draft');
  windowAt(600);
  await screen.rerender(<ChatsScreen />);
  expect(screen.queryByTestId('tablet-sidebar')).toBeNull();
  expect(screen.getByTestId('draft')).toHaveProp('value', 'Unsent draft');
  expect(screen.getByText('Back')).toBeOnTheScreen();
  windowAt(1032);
  await screen.rerender(<ChatsScreen />);
  expect(screen.getByTestId('draft')).toHaveProp('value', 'Unsent draft');
  expect(screen.queryByText('Back')).toBeNull();
  windowAt(600);
  await screen.rerender(<ChatsScreen />);
  await fireEvent.press(screen.getByText('Back'));
  expect(useChatSelection.getState().detail).toBeNull();
  expect(mockPush).not.toHaveBeenCalled();
});

it('does not open a same-id workspace on a different host', async () => {
  const screen = await render(<ChatsScreen />);
  mockConnectionId = 'host-b';
  await screen.rerender(<ChatsScreen />);
  expect(screen.queryByTestId('thread')).toBeNull();
});

it('waits for the saved host before redirecting a cold tablet deep link', async () => {
  mockHydrated = false;
  mockConnectionId = '';
  useChatSelection.getState().select(null);
  const screen = await render(<ThreadRoute />);
  expect(mockDismissTo).not.toHaveBeenCalled();
  expect(useChatSelection.getState().detail).toBeNull();
  mockConnectionId = 'host-a';
  mockHydrated = true;
  await screen.rerender(<ThreadRoute />);
  expect(mockDismissTo).toHaveBeenCalledWith('/');
  expect(useChatSelection.getState().detail?.connectionId).toBe('host-a');
});

it('changes only the selected detail and does not carry a draft into another chat', async () => {
  const screen = await render(<ChatsScreen />);
  await fireEvent.changeText(screen.getByTestId('draft'), 'For Notes only');
  await act(() => useChatSelection.getState().select({ connectionId: 'host-a', workspaceId: 'w3', title: 'Scratch' }));
  expect(screen.getByTestId('thread')).toHaveProp('accessibilityLabel', 'w3');
  expect(screen.getByTestId('draft')).toHaveProp('value', '');
  expect(screen.getByTestId('tablet-sidebar')).toBeOnTheScreen();
});
