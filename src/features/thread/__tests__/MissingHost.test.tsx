import { fireEvent, render } from '@testing-library/react-native';

import { MissingHost } from '../ThreadPlaceholders';

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));

it('offers Hosts for a chat whose host is gone', async () => {
  const onHosts = jest.fn();
  const onBack = jest.fn();
  const screen = await render(<MissingHost onBack={onBack} onHosts={onHosts} />);
  expect(screen.getByText("This chat's host is gone")).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('thread-open-hosts'));
  expect(onHosts).toHaveBeenCalledTimes(1);
});

it('goes back where there is a back', async () => {
  const onBack = jest.fn();
  const screen = await render(<MissingHost onBack={onBack} onHosts={jest.fn()} />);
  await fireEvent.press(screen.getByTestId('thread-host-back'));
  expect(onBack).toHaveBeenCalledTimes(1);
});
