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
  expect(screen.queryByTestId('thread-machine-enable')).toBeNull();
});

// Machines are not on the Hosts screen, and the host is fine: "Go to Hosts"
// opened a screen saying all was well, as if the phone were the problem.
it('leads back to the chats for a chat whose machine is gone, and names the way back', async () => {
  const onHosts = jest.fn();
  const onChats = jest.fn();
  const screen = await render(<MissingHost machine={{ label: 'klaw', host: 'Gimel' }} onHosts={onHosts} onChats={onChats} />);
  expect(screen.getByText("This chat's machine is gone")).toBeOnTheScreen();
  expect(screen.queryByTestId('thread-open-hosts')).toBeNull();
  expect(screen.getByTestId('thread-machine-enable')).toHaveTextContent(/run herdr machine enable klaw on Gimel/);
  await fireEvent.press(screen.getByTestId('thread-host-back'));
  expect(onChats).toHaveBeenCalledTimes(1);
  expect(onHosts).not.toHaveBeenCalled();
});

it('goes back where there is a back, rather than to the list root', async () => {
  const onBack = jest.fn();
  const onChats = jest.fn();
  const screen = await render(<MissingHost machine={{ label: null, host: 'Gimel' }} onBack={onBack} onHosts={jest.fn()} onChats={onChats} />);
  await fireEvent.press(screen.getByTestId('thread-host-back'));
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(onChats).not.toHaveBeenCalled();
});
