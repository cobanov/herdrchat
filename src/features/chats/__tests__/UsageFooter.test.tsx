import { act, fireEvent, render } from '@testing-library/react-native';

import type { HerdrTransport } from '@/lib/herdr/transport';
import { useSettings } from '@/state/settings';
import { resetPlanUsageSession, usePlanUsage } from '@/state/usage';
import { usageFooter } from '@/theme/tokens';
import { UsageFooter } from '../UsageFooter';

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({}) }));
/** False while a chat is pushed over the list, which stays mounted under it. */
let mockFocused = true;
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));
const mockConfirm = jest.fn();
const mockSheet = jest.fn();
jest.mock('@/components/ActionSheet', () => ({
  confirmDestructive: (options: unknown) => mockConfirm(options),
  showActionSheet: (options: unknown) => mockSheet(options),
}));

jest.mock('@/state/saveSetting', () => ({
  saveSetting: (_db: unknown, key: 'usageShown', value: 'left' | 'used') =>
    jest.requireActual('@/state/settings').useSettings.getState().set(key, value),
}));

const transport: HerdrTransport = {
  exec: async () => ({ ok: false, code: 'not_connected', message: 'no' }),
  streamLines: async function* () {
    yield* [];
  },
};
const mac = { id: 'mac', host: 'mac.tailnet', username: 'ln' };
const inHours = (hours: number) => Math.floor(Date.now() / 1000) + hours * 60 * 60;

// Jest's AppState hands back no subscription; React Native's always does.
const appState = jest.requireActual<typeof import('react-native')>('react-native').AppState;
let appStateListeners: ((state: string) => void)[] = [];
const appStateCurrent = Object.getOwnPropertyDescriptor(appState, 'currentState');
beforeAll(() => {
  jest.spyOn(appState, 'addEventListener').mockImplementation(((_: string, listener: (state: string) => void) => {
    appStateListeners.push(listener);
    return { remove: () => { appStateListeners = appStateListeners.filter((other) => other !== listener); } };
  }) as never);
  Object.defineProperty(appState, 'currentState', { configurable: true, get: () => 'active' });
});
afterAll(() => {
  jest.restoreAllMocks();
  if (appStateCurrent) Object.defineProperty(appState, 'currentState', appStateCurrent);
});

beforeEach(() => {
  appStateListeners = [];
  mockFocused = true;
  resetPlanUsageSession();
  useSettings.getState().set('usageShown', 'left');
  mockConfirm.mockClear();
  mockSheet.mockClear();
});

// The footer rode the list's poll, 30 s apart once the host's events were live,
// while Claude rewrites the file every few seconds: it looked frozen. Then it
// read every few seconds under a pushed chat too, where nobody could see it.
// Fake timers hang this library's async render, so the footer's own interval
// is caught as it is set and fired by hand.
it('reads the host every few seconds while on screen and the app is in front, and not otherwise', async () => {
  const live = new Set<() => void>();
  const realSet = global.setInterval;
  const realClear = global.clearInterval;
  const handles = new Map<unknown, () => void>();
  const set = jest.spyOn(global, 'setInterval').mockImplementation(((fn: () => void, ms: number) => {
    if (ms !== usageFooter.liveReadMs) return realSet(fn, ms);
    const handle = { fn };
    live.add(fn);
    handles.set(handle, fn);
    return handle;
  }) as never);
  const clear = jest.spyOn(global, 'clearInterval').mockImplementation(((handle: unknown) => {
    const fn = handles.get(handle);
    if (fn === undefined) return realClear(handle as ReturnType<typeof setInterval>);
    live.delete(fn);
  }) as never);
  const tick = () => live.forEach((fn) => fn());
  const exec = jest.fn(async () => ({ ok: false as const, code: 'not_connected' as const, message: 'no' }));
  const counting: HerdrTransport = { ...transport, exec };
  try {
    usePlanUsage.setState({ consent: { mac: true } });
    const screen = await render(<UsageFooter host={mac} transport={counting} />);
    expect(exec).toHaveBeenCalledTimes(1);
    await act(async () => tick());
    expect(exec).toHaveBeenCalledTimes(2);
    await act(async () => appStateListeners.forEach((listener) => listener('background')));
    await act(async () => tick());
    expect(exec).toHaveBeenCalledTimes(2);
    await act(async () => appStateListeners.forEach((listener) => listener('active')));
    expect(exec).toHaveBeenCalledTimes(3);
    // A chat pushed over the list: still mounted, no longer read.
    mockFocused = false;
    await screen.rerender(<UsageFooter host={mac} transport={counting} />);
    await act(async () => tick());
    expect(exec).toHaveBeenCalledTimes(3);
    mockFocused = true;
    await screen.rerender(<UsageFooter host={mac} transport={counting} />);
    expect(exec).toHaveBeenCalledTimes(4);
    await screen.unmount();
    await act(async () => tick());
    expect(exec).toHaveBeenCalledTimes(4);
  } finally {
    set.mockRestore();
    clear.mockRestore();
  }
});

it('offers to set it up where the person has not agreed, naming the host and the user', async () => {
  const screen = await render(<UsageFooter host={mac} transport={transport} />);
  expect(screen.getByTestId('usage-setup')).toHaveTextContent(/Show Claude usage/);
  expect(screen.queryByTestId('usage-week')).toBeNull();
  await act(async () => fireEvent.press(screen.getByTestId('usage-setup')));
  expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Show Claude usage from mac.tailnet?',
    confirmLabel: 'Set up',
    message: expect.stringContaining('on mac.tailnet (as ln)'),
  }));
  // The host could not be reached: the reason under the row, and no agreement.
  const [[{ onConfirm }]] = mockConfirm.mock.calls as [[{ onConfirm: () => void }]];
  await act(async () => onConfirm());
  expect(screen.getByTestId('usage-error')).toHaveTextContent('no');
  expect(usePlanUsage.getState().consent).toEqual({});
});

it('shows the share left, a bar and the reset of each window', async () => {
  usePlanUsage.setState({
    consent: { mac: true },
    byConnection: { mac: { capturedAt: Math.floor(Date.now() / 1000), sevenDay: { percentLeft: 62, resetsAt: inHours(72) }, fiveHour: { percentLeft: 80, resetsAt: inHours(2) } } },
  });
  const screen = await render(<UsageFooter host={mac} transport={transport} />);
  expect(screen.getByTestId('usage-week')).toHaveTextContent(/Week62% left/);
  expect(screen.getByTestId('usage-week').props.accessibilityLabel).toMatch(/^Weekly limit, 62 percent left, resets /);
  expect(screen.getByTestId('usage-5h')).toHaveTextContent(/5h80% left/);
  expect(screen.queryByText(/^as of/)).toBeNull();
  expect(screen.queryByTestId('usage-setup')).toBeNull();
  // Tapping the block offers the share used instead, and to turn it off.
  await act(async () => fireEvent.press(screen.getByTestId('usage-footer')));
  expect(mockSheet).toHaveBeenCalledWith(expect.objectContaining({
    actions: [
      expect.objectContaining({ label: 'Show % used' }),
      expect.objectContaining({ label: 'Turn off Claude usage', destructive: true }),
    ],
  }));
  const [[{ actions }]] = mockSheet.mock.calls as [[{ actions: { onPress: () => void }[] }]];
  await act(async () => actions[0]!.onPress());
  expect(screen.getByTestId('usage-5h')).toHaveTextContent(/5h20% used/);
  expect(screen.getByTestId('usage-week')).toHaveTextContent(/Week38% used/);
  expect(screen.getByTestId('usage-week').props.accessibilityLabel).toMatch(/^Weekly limit, 38 percent used, resets /);
});

it('says when old numbers were taken', async () => {
  usePlanUsage.setState({
    consent: { mac: true },
    byConnection: { mac: { capturedAt: Math.floor(Date.now() / 1000) - 60 * 60, sevenDay: { percentLeft: 62, resetsAt: inHours(72) }, fiveHour: null } },
  });
  const screen = await render(<UsageFooter host={mac} transport={transport} />);
  expect(screen.getByText(/^as of /)).toBeTruthy();
  expect(screen.queryByTestId('usage-5h')).toBeNull();
});

it('says when usage will appear while the host has none yet, and nothing before the first read', async () => {
  usePlanUsage.setState({ consent: { mac: true }, byConnection: {} });
  const screen = await render(<UsageFooter host={mac} transport={transport} />);
  expect(screen.toJSON()).toBeNull();
  await act(async () => usePlanUsage.getState().set('mac', null));
  expect(screen.getByTestId('usage-footer')).toHaveTextContent(/Usage appears after Claude runs here/);
});

// The Demo shows usage without being set up, and has nothing to turn off.
it('shows the Demo’s usage without a setup, and offers no Turn off there', async () => {
  useSettings.getState().set('usageShown', 'used');
  usePlanUsage.setState({ consent: {}, byConnection: { demo: { capturedAt: Math.floor(Date.now() / 1000), sevenDay: { percentLeft: 62, resetsAt: inHours(72) }, fiveHour: null } } });
  const screen = await render(<UsageFooter host={{ id: 'demo', host: 'demo.local', username: 'demo' }} transport={transport} />);
  expect(screen.getByTestId('usage-week')).toHaveTextContent(/38% used/);
  await act(async () => fireEvent.press(screen.getByTestId('usage-footer')));
  expect(mockSheet).toHaveBeenCalledWith(expect.objectContaining({ actions: [expect.objectContaining({ label: 'Show % left' })] }));
});
