import { fireEvent, render } from '@testing-library/react-native';

import { WATCHER_VERSION, type WatcherState } from '@/lib/notifier/watcher';
import { WatcherRow } from '../WatcherRow';

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));

const control = (state: WatcherState | null) => ({ state, busy: false, error: null, install: jest.fn(async () => undefined) });

// Without a watcher there are no notifications, whatever the switch says, so
// each state says what it means and offers the one action that fits (#95).
it.each([
  [{ kind: 'missing', manual: false } as const, 'Nothing on mini sends notifications yet.', 'Install watcher on mini'],
  [{ kind: 'stopped', version: WATCHER_VERSION, service: 'launchd' } as const, "The watcher on mini isn't running.", 'Start watcher'],
  [{ kind: 'running', version: WATCHER_VERSION - 1, service: 'launchd', lingering: null } as const, 'mini runs an older watcher.', 'Update watcher'],
])('offers the right action for %j', async (state, message, action) => {
  const watcher = control(state);
  const screen = await render(<WatcherRow host="mini" watcher={watcher} />);
  expect(screen.getByText(message)).toBeOnTheScreen();
  await fireEvent.press(screen.getByText(action));
  expect(watcher.install).toHaveBeenCalledTimes(1);
});

it('asks for nothing once the watcher runs, and says what a plain process lacks', async () => {
  const screen = await render(
    <WatcherRow host="mini" watcher={control({ kind: 'running', version: WATCHER_VERSION, service: 'process', lingering: null })} />
  );
  expect(screen.getByText('Watcher running on mini.')).toBeOnTheScreen();
  expect(screen.getByText(/runs until mini restarts/)).toBeOnTheScreen();
  expect(screen.queryByTestId('watcher-install')).toBeNull();
});

it('explains a host without python3 and offers nothing it cannot do', async () => {
  const screen = await render(<WatcherRow host="mini" watcher={control({ kind: 'no_python' })} />);
  expect(screen.getByText("The watcher needs python3, which mini doesn't have.")).toBeOnTheScreen();
  expect(screen.queryByTestId('watcher-install')).toBeNull();
});

it('shows nothing before the host has answered', async () => {
  const screen = await render(<WatcherRow host="mini" watcher={control(null)} />);
  expect(screen.queryByTestId('watcher-row')).toBeNull();
});
