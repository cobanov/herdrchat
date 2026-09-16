import { act, fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import * as Native from 'react-native';

import ChatsScreen from '../../../../app/(tabs)/index';
import { openChat } from '../navigation';
import { useChatSelection } from '@/state/chatSelection';

let mockConnectionId = 'host-a';
const mockPush = jest.fn();
const mockDismissTo = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), dismissTo: (...args: unknown[]) => mockDismissTo(...args) },
}));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: jest.fn(),
}));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: { systemBackground: '#000', separator: '#333' } }),
}));
jest.mock('@/state/connections', () => ({ useSelectedConnection: () => ({ id: mockConnectionId }) }));
jest.mock('@/features/chats/ChatsList', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/EmptyState', () => ({ EmptyState: () => null }));
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
  mockPush.mockClear();
  mockDismissTo.mockClear();
});
afterAll(() => {
  if (originalPad) Object.defineProperty(Native.Platform, 'isPad', originalPad);
});

it('uses the Chats tab for all iPad chat entry points, including narrow windows', () => {
  openChat('host-a', 'w2', 'Notes');
  expect(mockDismissTo).toHaveBeenCalledWith('/');
  expect(useChatSelection.getState().selection).toEqual({ connectionId: 'host-a', workspaceId: 'w2', title: 'Notes' });
  expect(mockPush).not.toHaveBeenCalled();
  windowAt(600);
  openChat('host-a', 'w3');
  expect(mockDismissTo).toHaveBeenCalledTimes(2);
  expect(mockPush).not.toHaveBeenCalled();
  windowAt(932, false);
  openChat('host-a', 'w2');
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/chat/[workspaceId]', params: { connectionId: 'host-a', workspaceId: 'w2', title: '' } });
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
  expect(useChatSelection.getState().selection).toBeNull();
  expect(mockPush).not.toHaveBeenCalled();
});

it('does not open a same-id workspace on a different host', async () => {
  const screen = await render(<ChatsScreen />);
  mockConnectionId = 'host-b';
  await screen.rerender(<ChatsScreen />);
  expect(screen.queryByTestId('thread')).toBeNull();
});

it('changes only the selected detail and does not carry a draft into another chat', async () => {
  const screen = await render(<ChatsScreen />);
  await fireEvent.changeText(screen.getByTestId('draft'), 'For Notes only');
  await act(() => useChatSelection.getState().select({ connectionId: 'host-a', workspaceId: 'w3', title: 'Scratch' }));
  expect(screen.getByTestId('thread')).toHaveProp('accessibilityLabel', 'w3');
  expect(screen.getByTestId('draft')).toHaveProp('value', '');
  expect(screen.getByTestId('tablet-sidebar')).toBeOnTheScreen();
});
