import { act, render } from '@testing-library/react-native';

import { SLOW_CONNECT_MS } from '@/lib/connecting';
import { SkeletonRows } from '../SkeletonRows';

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));

// With Tailscale off the poll hangs until it times out; the list must say why
// it might be waiting before then, not sit on a bare "Connecting…".
it('names the host, then explains a slow connection', async () => {
  jest.useFakeTimers();
  const screen = await render(<SkeletonRows host={{ name: 'mac-studio', host: '100.64.0.2' }} />);
  expect(screen.getByText('Connecting to mac-studio…')).toBeTruthy();
  expect(screen.queryByTestId('chats-connecting-hint')).toBeNull();

  await act(async () => {
    jest.advanceTimersByTime(SLOW_CONNECT_MS);
  });
  expect(screen.getByTestId('chats-connecting-hint').props.children).toMatch(/Tailscale is on here/);
  jest.useRealTimers();
});
