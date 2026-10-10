import { act, fireEvent, render } from '@testing-library/react-native';
import { View as MockView, type ViewProps } from 'react-native';

import { DEMO_SHELL_SCREEN } from '@/lib/demo/terminal';
import TerminalScreen from '../TerminalScreen';

type Closed = (event: { shellId: string; reason: string; exitCode?: number; message?: string }) => void;

const mockOpenShell = jest.fn();
const mockCloseShell = jest.fn(async (_id: string) => undefined);
const mockWrite = jest.fn(async (_id: string, _text: string) => ({ ok: true }));
let mockClosed: Closed | null = null;
let mockShellCount = 0;
jest.mock('../../../../modules/herdr-ssh/src', () => ({
  openShell: (...args: unknown[]) => mockOpenShell(...args),
  closeShell: (id: string) => mockCloseShell(id),
  writeShellText: (id: string, text: string) => mockWrite(id, text),
  utf8Bytes: (text: string) => Uint8Array.from(Buffer.from(text, 'utf8')),
  base64FromBytes: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64'),
}));

const mockFeed = jest.fn((_id: string, _base64: string) => true);
const mockHandle = { focus: jest.fn(async () => undefined), blur: jest.fn(async () => undefined), paste: jest.fn(async () => undefined), clearScrollback: jest.fn(async () => undefined) };
let mockAvailable = true;
/** The size the fake view reports on mounting, as the real one does on its first layout. */
jest.mock('../../../../modules/herdr-terminal/src', () => {
  const { useEffect, useImperativeHandle } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  function FakeTerminal(props: { ref?: unknown; testID?: string; shellId: string | null; onSizeChange?: (size: { cols: number; rows: number }) => void }) {
    useImperativeHandle(props.ref, () => mockHandle);
    useEffect(() => {
      props.onSizeChange?.({ cols: 80, rows: 24 });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return <View testID={props.testID} accessibilityValue={{ text: props.shellId ?? '' }} />;
  }
  return {
    TerminalView: FakeTerminal,
    feed: (id: string, base64: string) => mockFeed(id, base64),
    get isTerminalAvailable() {
      return mockAvailable;
    },
  };
});

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('react-native-keyboard-controller', () => jest.requireActual('react-native-keyboard-controller/jest'));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: ViewProps) => <MockView {...props} />,
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, scheme: 'dark', reduceMotion: true }),
}));
jest.mock('@/components/Glass', () => ({ Glass: (props: ViewProps) => <MockView {...props} /> }));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));

const mockExec = jest.fn(async (_command: string, _timeout: number) => ({ ok: true, stdout: '', stderr: '', exitCode: 0 }));
const mockSocketCall = jest.fn(async (_method: string, _params: unknown, _timeout: number) => ({}));
const mockClient = {
  snapshot: async () => ({
    focusedPaneId: 'w6:p1',
    layouts: [{ focusedPaneId: 'w6:p1', zoomed: false, panes: [{ paneId: 'w6:p1' }, { paneId: 'w6:p3' }] }],
  }),
  transport: { exec: (command: string, timeout: number) => mockExec(command, timeout) },
  socket: { call: (method: string, params: unknown, timeout: number) => mockSocketCall(method, params, timeout) },
};
const mockTransportOpen = jest.fn(async () => ({ ok: true, fingerprint: 'SHA256:x' }));
let mockConnection: Record<string, unknown> | null = null;
jest.mock('@/state/connections', () => ({
  useConnectionFor: () => mockConnection,
  useConnections: (select: (state: { hydrated: boolean }) => unknown) => select({ hydrated: true }),
  clientFor: () => mockClient,
  isMachineConnection: (connection: { kind?: string }) => connection.kind === 'machine',
  isDemo: (id: string) => id === 'demo',
  transportFor: () => ({ open: mockTransportOpen }),
}));

const host = { id: 'srv-1', name: 'Gimel', host: 'gimel', port: 22, username: 'k', authKind: 'privateKey', herdrPath: 'herdr', sessionName: '' };
const demo = { ...host, id: 'demo', name: 'Demo' };

const settle = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAvailable = true;
  mockClosed = null;
  mockOpenShell.mockImplementation(async (_id: string, options: { onClosed?: Closed }) => {
    mockClosed = options.onClosed ?? null;
    mockShellCount += 1;
    return { ok: true, shellId: `t-${mockShellCount}` };
  });
});

it("opens the Demo's shell pane at the view's size, shows its recording, and hangs up on leaving", async () => {
  mockConnection = demo;
  const screen = await render(<TerminalScreen connectionId="demo" paneId="w6:p3" kind="shell" title="zsh · demo/api" onBack={jest.fn()} />);
  await settle();
  expect(mockOpenShell).toHaveBeenCalledWith('demo', expect.objectContaining({ cols: 80, rows: 24 }));
  // No SSH under the Demo: nothing to dial, nothing to zoom or put back.
  expect(mockTransportOpen).not.toHaveBeenCalled();
  const shellId = mockOpenShell.mock.results[0] === undefined ? '' : (await mockOpenShell.mock.results[0].value).shellId;
  expect(mockFeed).toHaveBeenCalledWith(shellId, Buffer.from(DEMO_SHELL_SCREEN, 'utf8').toString('base64'));
  expect(screen.getByTestId('terminal-title')).toHaveTextContent('zsh · demo/api');
  expect(screen.getByTestId('terminal-status')).toHaveTextContent('Connected');
  expect(screen.queryByTestId('terminal-reconnect')).toBeNull();
  await screen.unmount();
  expect(mockCloseShell).toHaveBeenCalledWith(shellId);
  expect(mockExec).not.toHaveBeenCalled();
});

it('sends the bar\'s keys as a terminal does, with Ctrl held for one key', async () => {
  mockConnection = demo;
  const screen = await render(<TerminalScreen connectionId="demo" paneId="w6:p3" kind="shell" title="Terminal" onBack={jest.fn()} />);
  await settle();
  await fireEvent.press(screen.getByTestId('terminal-key-esc'));
  expect(mockWrite).toHaveBeenLastCalledWith(expect.any(String), '\u001b');
  await fireEvent.press(screen.getByTestId('terminal-key-up'));
  expect(mockWrite).toHaveBeenLastCalledWith(expect.any(String), '\u001b[A');
  await fireEvent.press(screen.getByTestId('terminal-key-ctrl'));
  expect(screen.getByTestId('terminal-key-ctrl')).toHaveProp('accessibilityState', expect.objectContaining({ checked: true }));
  await fireEvent.press(screen.getByTestId('terminal-key-dash'));
  expect(mockWrite).toHaveBeenLastCalledWith(expect.any(String), '\u001f');
  // Let go after the one key.
  expect(screen.getByTestId('terminal-key-ctrl')).toHaveProp('accessibilityState', expect.objectContaining({ checked: false }));
  await fireEvent.press(screen.getByTestId('terminal-key-dash'));
  expect(mockWrite).toHaveBeenLastCalledWith(expect.any(String), '-');
  await fireEvent.press(screen.getByTestId('terminal-paste'));
  expect(mockHandle.paste).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('terminal-keyboard'));
  expect(mockHandle.focus).toHaveBeenCalledTimes(1);
  await screen.unmount();
});

// A route change takes the connection, and the shell with it. The screen says
// so and offers one tap back; the new shell goes to the same view.
it('says the connection dropped, reconnects on a tap, and on leaving puts back the zoom and focus it moved', async () => {
  mockConnection = host;
  const screen = await render(<TerminalScreen connectionId="srv-1" paneId="w6:p3" kind="shell" title="Terminal" onBack={jest.fn()} />);
  await settle();
  expect(mockTransportOpen).toHaveBeenCalledTimes(1);
  const first = (await mockOpenShell.mock.results[0]?.value).shellId as string;
  expect(mockOpenShell.mock.calls[0]?.[1].command).toContain("'session' 'attach' 'default'");
  await act(async () => mockClosed?.({ shellId: first, reason: 'connection_lost' }));
  expect(screen.getByTestId('terminal-status')).toHaveTextContent('Connection lost');
  expect(screen.getByTestId('error-banner')).toHaveTextContent(/dropped/);
  // Nothing to send to: the bar's keys are off until it is back.
  expect(screen.getByTestId('terminal-key-esc')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('terminal-reconnect'));
  await settle();
  expect(mockOpenShell).toHaveBeenCalledTimes(2);
  const second = (await mockOpenShell.mock.results[1]?.value).shellId as string;
  expect(screen.getByTestId('terminal-view')).toHaveProp('accessibilityValue', { text: second });
  expect(screen.getByTestId('terminal-status')).toHaveTextContent('Connected');
  await screen.unmount();
  await settle();
  expect(mockCloseShell).toHaveBeenCalledWith(second);
  // The app zoomed the pane (it was not before) and herdr's focus was on p1.
  expect(mockExec).toHaveBeenCalledWith(expect.stringContaining("'zoom' '--pane' 'w6:p3' '--off'"), expect.any(Number));
  expect(mockSocketCall).toHaveBeenCalledWith('pane.focus', { pane_id: 'w6:p1' }, expect.any(Number));
});

it('says why the shell did not open, and tries again on Reconnect', async () => {
  mockConnection = host;
  mockOpenShell.mockResolvedValueOnce({ ok: false, code: 'not_connected', message: 'No live connection for this server.' });
  const screen = await render(<TerminalScreen connectionId="srv-1" paneId="w6:p1" kind="agent" title="api" onBack={jest.fn()} />);
  await settle();
  expect(screen.getByTestId('terminal-status')).toHaveTextContent('Not connected');
  expect(screen.getByTestId('error-banner')).toHaveTextContent('No live connection for this server.');
  await fireEvent.press(screen.getByTestId('terminal-reconnect'));
  await settle();
  expect(screen.getByTestId('terminal-status')).toHaveTextContent('Connected');
  await screen.unmount();
  // An agent pane's attach zooms nothing, so leaving puts nothing back.
  expect(mockExec).not.toHaveBeenCalled();
  expect(mockSocketCall).not.toHaveBeenCalled();
});

it('says so where this build has no terminal, rather than a blank screen', async () => {
  mockConnection = host;
  mockAvailable = false;
  const screen = await render(<TerminalScreen connectionId="srv-1" paneId="w6:p3" kind="shell" title="Terminal" onBack={jest.fn()} />);
  await settle();
  expect(screen.getByText('No terminal here')).toBeOnTheScreen();
  expect(mockOpenShell).not.toHaveBeenCalled();
  await screen.unmount();
});
