import { act, fireEvent, render } from '@testing-library/react-native';
import * as Native from 'react-native';

import ChatsScreen from '../../../../app/(tabs)/index';
import TerminalRoute from '../../../../app/chat/terminal';
import { openChat } from '@/features/chats/navigation';
import { terminalBackControl } from '../backControl';
import { openTerminal, type TerminalRouteParams } from '../navigation';
import { detailAfterClose, useChatSelection } from '@/state/chatSelection';

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
// Each column is a safe-area provider; the real one waits for native insets.
jest.mock('react-native-safe-area-context', () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default);
jest.mock('@/state/connections', () => ({
  useSelectedConnection: () => ({ id: mockConnectionId }),
  // Two saved hosts: every one's chats and terminals are in the one list.
  useConnections: (selector: (state: { hydrated: boolean; connections: { id: string }[] }) => unknown) =>
    selector({ hydrated: mockHydrated, connections: [{ id: 'host-a' }, { id: 'host-b' }] }),
  isDemo: () => false,
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
  default: ({ paneId, kind, terminalId, back, onBack }: { paneId: string; kind: string; terminalId: string | null; back?: { symbol: string; label: string }; onBack: () => void }) => {
    const { Button, View } = jest.requireActual<typeof import('react-native')>('react-native');
    return (
      <View testID="terminal-view" accessibilityLabel={`${paneId} ${kind} ${terminalId ?? 'none'}`}>
        <Button testID={`terminal-back-${back?.symbol ?? 'default'}`} title={back?.label ?? 'Back'} onPress={onBack} />
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

  it('remembers nothing when no chat was open', () => {
    openTerminal(shellPane);
    expect(useChatSelection.getState().detail).toEqual(expect.objectContaining({ kind: 'terminal', terminalId: 'term_w6_p3', from: null }));
    openTerminal(agentPane);
    expect(useChatSelection.getState().detail).toEqual(expect.objectContaining({ kind: 'terminal', paneId: 'w2:p1', from: null }));
  });

  // Tapping the lit terminal row again changes nothing on screen, so it must
  // not change where Back goes either; nor must opening another pane's.
  it('carries the chat forward when it replaces another terminal', () => {
    useChatSelection.getState().select(notes);
    openTerminal(shellPane);
    openTerminal(shellPane);
    expect(useChatSelection.getState().detail).toEqual(expect.objectContaining({ paneId: 'w6:p3', from: notes }));
    openTerminal(agentPane);
    expect(useChatSelection.getState().detail).toEqual(expect.objectContaining({ paneId: 'w2:p1', from: notes }));
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
    expect(screen.getByTestId('terminal-back-chevron.left')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Back to Notes'));
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

  it('keeps a terminal on any listed host, and never shows one on a host that is gone', async () => {
    openTerminal(shellPane);
    const screen = await render(<ChatsScreen />);
    mockConnectionId = 'host-b';
    await screen.rerender(<ChatsScreen />);
    expect(screen.getByTestId('terminal-view')).toBeOnTheScreen();
    await act(() => openTerminal({ ...shellPane, connectionId: 'gone' }));
    expect(screen.queryByTestId('terminal-view')).toBeNull();
    expect(lastListProps()).toEqual(expect.objectContaining({ selectedTerminal: undefined }));
    mockConnectionId = 'host-a';
  });
});

describe('the terminal\'s leading control', () => {
  it('is Back alone on the screen, and beside the chats says where it goes, or Close', () => {
    expect(terminalBackControl(false, null)).toEqual({ symbol: 'chevron.left', label: 'Back' });
    expect(terminalBackControl(false, notes)).toEqual({ symbol: 'chevron.left', label: 'Back' });
    expect(terminalBackControl(true, notes)).toEqual({ symbol: 'chevron.left', label: 'Back to Notes' });
    expect(terminalBackControl(true, null)).toEqual({ symbol: 'xmark', label: 'Close' });
  });

  it('closes a terminal opened beside the chats with nothing open', async () => {
    openTerminal(shellPane);
    const screen = await render(<ChatsScreen />);
    expect(screen.getByTestId('terminal-back-xmark')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Close'));
    expect(useChatSelection.getState().detail).toBeNull();
  });
});

describe('closing a workspace', () => {
  const closed = { connectionId: 'host-a', workspaceId: 'w6', paneIds: ['w6:p1', 'w6:p3'] };
  const terminalOn = (paneId: string, connectionId = 'host-a', from: typeof notes | null = null) =>
    ({ kind: 'terminal' as const, connectionId, paneId, terminalId: null, paneKind: 'shell' as const, title: 'sh', from });

  it('drops its chat, and a terminal on one of its panes', () => {
    expect(detailAfterClose({ kind: 'chat', connectionId: 'host-a', workspaceId: 'w6', title: 'api' }, closed)).toBeNull();
    expect(detailAfterClose(terminalOn('w6:p3'), closed)).toBeNull();
  });

  it('keeps a terminal elsewhere, by pane and by connection, but forgets a way back to the closed chat', () => {
    expect(detailAfterClose(terminalOn('w2:p1'), closed)).toEqual(terminalOn('w2:p1'));
    expect(detailAfterClose(terminalOn('w6:p3', 'host-b'), closed)).toEqual(terminalOn('w6:p3', 'host-b'));
    const fromClosed = { connectionId: 'host-a', workspaceId: 'w6', title: 'api' };
    expect(detailAfterClose(terminalOn('w2:p1', 'host-a', fromClosed), closed)).toEqual(terminalOn('w2:p1'));
    expect(detailAfterClose(terminalOn('w2:p1', 'host-a', notes), closed)).toEqual(terminalOn('w2:p1', 'host-a', notes));
    expect(detailAfterClose({ kind: 'chat', ...notes }, closed)).toEqual({ kind: 'chat', ...notes });
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
