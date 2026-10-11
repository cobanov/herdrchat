import { act, fireEvent, render } from '@testing-library/react-native';
import * as Native from 'react-native';

import ChatsScreen from '../../../../app/index';
import TerminalRoute from '../../../../app/chat/terminal';
import { openChat } from '@/features/chats/navigation';
import { openTerminal, type TerminalRouteParams } from '../navigation';
import { useChatSelection } from '@/state/chatSelection';

let mockConnectionId = 'host-a';
let mockHydrated = true;
const mockPush = jest.fn();
const mockDismissTo = jest.fn();
const mockBack = jest.fn();
const mockListProps = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ connectionId: 'host-a', paneId: 'w6:p3', kind: 'shell', terminalId: 'term_w6_p3', title: 'vim · api' }),
  useRouter: () => ({ back: mockBack }),
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
jest.mock('@/features/chats/ChatsList', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockListProps(props);
    return null;
  },
}));
jest.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/EmptyState', () => ({ EmptyState: () => null }));
jest.mock('@/features/thread/ThreadScreen', () => ({
  __esModule: true,
  default: ({ workspaceId }: { workspaceId: string }) => {
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return <View testID="thread" accessibilityLabel={workspaceId} />;
  },
}));
jest.mock('../TerminalScreen', () => ({
  __esModule: true,
  default: ({ paneId, kind, terminalId, onBack }: { paneId: string; kind: string; terminalId: string | null; onBack: () => void }) => {
    const { Button, View } = jest.requireActual<typeof import('react-native')>('react-native');
    return (
      <View testID="terminal-view" accessibilityLabel={`${paneId} ${kind} ${terminalId ?? 'none'}`}>
        <Button title="Back" onPress={onBack} />
      </View>
    );
  },
}));

const shellPane: TerminalRouteParams = { connectionId: 'host-a', paneId: 'w6:p3', kind: 'shell', terminalId: 'term_w6_p3', title: 'vim · api' };
const agentPane: TerminalRouteParams = { connectionId: 'host-a', paneId: 'w2:p1', kind: 'agent', terminalId: '', title: 'Notes' };
const notes = { connectionId: 'host-a', workspaceId: 'w2', title: 'Notes' };

const originalPad = Object.getOwnPropertyDescriptor(Native.Platform, 'isPad');
function windowAt(width: number, isPad = true) {
  Object.defineProperty(Native.Platform, 'isPad', { configurable: true, get: () => isPad });
  jest.mocked(Native.useWindowDimensions).mockReturnValue({ width, height: 1024, scale: 2, fontScale: 1 });
}
const lastListProps = () => mockListProps.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;

beforeEach(() => {
  windowAt(1032);
  useChatSelection.getState().select(null);
  mockConnectionId = 'host-a';
  mockHydrated = true;
  jest.clearAllMocks();
});
afterAll(() => {
  if (originalPad) Object.defineProperty(Native.Platform, 'isPad', originalPad);
});

describe('the detail store', () => {
  it('holds one detail: a terminal replaces a chat, and a chat replaces the terminal', () => {
    useChatSelection.getState().select(notes);
    useChatSelection.getState().showTerminal({ connectionId: 'host-a', paneId: 'w6:p3', terminalId: null, paneKind: 'shell', title: 'sh', from: notes });
    expect(useChatSelection.getState().detail).toEqual({ kind: 'terminal', connectionId: 'host-a', paneId: 'w6:p3', terminalId: null, paneKind: 'shell', title: 'sh', from: notes });
    openChat('host-a', 'w3', 'Scratch');
    expect(useChatSelection.getState().detail).toEqual({ kind: 'chat', connectionId: 'host-a', workspaceId: 'w3', title: 'Scratch' });
  });
});

describe('openTerminal', () => {
  it('on iPad makes the terminal the detail, remembering the open chat, and dismisses to the chats', () => {
    useChatSelection.getState().select({ ...notes, paneId: 'w2:p1' });
    openTerminal(agentPane);
    expect(useChatSelection.getState().detail).toEqual({
      kind: 'terminal', connectionId: 'host-a', paneId: 'w2:p1', terminalId: null, paneKind: 'agent', title: 'Notes',
      from: { ...notes, paneId: 'w2:p1' },
    });
    expect(mockDismissTo).toHaveBeenCalledWith('/');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('remembers nothing when no chat was open, or when it replaces another terminal', () => {
    openTerminal(shellPane);
    expect(useChatSelection.getState().detail).toEqual(expect.objectContaining({ kind: 'terminal', terminalId: 'term_w6_p3', from: null }));
    openTerminal(agentPane);
    expect(useChatSelection.getState().detail).toEqual(expect.objectContaining({ kind: 'terminal', paneId: 'w2:p1', from: null }));
  });

  it('does the same in a narrow iPad window', () => {
    windowAt(600);
    openTerminal(shellPane);
    expect(useChatSelection.getState().detail?.kind).toBe('terminal');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('on a phone pushes the route and leaves the selection alone', () => {
    windowAt(402, false);
    openTerminal(shellPane);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/chat/terminal', params: shellPane });
    expect(mockDismissTo).not.toHaveBeenCalled();
    expect(useChatSelection.getState().detail).toBeNull();
  });
});

describe('the root on iPad', () => {
  it('shows a terminal beside the chats, lights its row and no chat, and Back brings back the chat it came from', async () => {
    useChatSelection.getState().select(notes);
    const screen = await render(<ChatsScreen />);
    expect(screen.getByTestId('thread')).toBeOnTheScreen();
    await act(() => openTerminal(agentPane));
    expect(screen.getByTestId('tablet-sidebar')).toBeOnTheScreen();
    expect(screen.queryByTestId('thread')).toBeNull();
    expect(screen.getByTestId('terminal-view')).toHaveProp('accessibilityLabel', 'w2:p1 agent none');
    expect(lastListProps()).toEqual(expect.objectContaining({
      selectedWorkspaceId: undefined, selectedTerminal: { connectionId: 'host-a', paneId: 'w2:p1' },
    }));
    await fireEvent.press(screen.getByText('Back'));
    expect(screen.getByTestId('thread')).toHaveProp('accessibilityLabel', 'w2');
    expect(lastListProps()).toEqual(expect.objectContaining({ selectedWorkspaceId: 'w2', selectedTerminal: undefined }));
  });

  it('goes back to "Select a conversation" for a terminal opened with nothing open, at any width', async () => {
    windowAt(600);
    openTerminal(shellPane);
    const screen = await render(<ChatsScreen />);
    expect(screen.queryByTestId('tablet-sidebar')).toBeNull();
    expect(screen.getByTestId('terminal-view')).toHaveProp('accessibilityLabel', 'w6:p3 shell term_w6_p3');
    await fireEvent.press(screen.getByText('Back'));
    expect(useChatSelection.getState().detail).toBeNull();
    expect(screen.queryByTestId('terminal-view')).toBeNull();
  });

  it('never carries a terminal onto another host, and keeps one on this host\'s machine', async () => {
    openTerminal(shellPane);
    const screen = await render(<ChatsScreen />);
    mockConnectionId = 'host-b';
    await screen.rerender(<ChatsScreen />);
    expect(screen.queryByTestId('terminal-view')).toBeNull();
    expect(lastListProps()).toEqual(expect.objectContaining({ selectedTerminal: undefined }));
    mockConnectionId = 'host-a';
    await act(() => openTerminal({ ...shellPane, connectionId: 'host-a/nuku' }));
    expect(screen.getByTestId('terminal-view')).toBeOnTheScreen();
  });
});

describe('a link to the terminal route', () => {
  it('on iPad waits for the saved hosts, then hands over to the detail and draws nothing', async () => {
    mockHydrated = false;
    const screen = await render(<TerminalRoute />);
    expect(mockDismissTo).not.toHaveBeenCalled();
    expect(screen.queryByTestId('terminal-view')).toBeNull();
    mockHydrated = true;
    await screen.rerender(<TerminalRoute />);
    expect(mockDismissTo).toHaveBeenCalledWith('/');
    expect(useChatSelection.getState().detail).toEqual(expect.objectContaining({ kind: 'terminal', paneId: 'w6:p3', terminalId: 'term_w6_p3' }));
    expect(screen.queryByTestId('terminal-view')).toBeNull();
  });

  it('on a phone is the terminal, and Back pops it', async () => {
    windowAt(402, false);
    const screen = await render(<TerminalRoute />);
    expect(screen.getByTestId('terminal-view')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Back'));
    expect(mockBack).toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();
  });
});
