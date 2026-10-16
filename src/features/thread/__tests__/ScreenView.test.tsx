import { fireEvent, render } from '@testing-library/react-native';

import { ScreenView } from '../ScreenView';

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));

// herdr has no Gemini integration: its chat is its screen, and the hook that
// would report its log installs from there.
it('offers the hook that makes a screen chat readable, and says why it failed', async () => {
  const onInstall = jest.fn();
  const screen = await render(
    <ScreenView text="> hello" agent="Gemini" topInset={0} bottomInset={0} onInstall={onInstall} installError="python3 is missing." />
  );
  expect(screen.getByTestId('agent-screen-text')).toHaveTextContent('> hello');
  expect(screen.getByText(/Install HerdrChat's hook for Gemini/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('install-integration'));
  expect(onInstall).toHaveBeenCalledTimes(1);
  expect(screen.getByText('python3 is missing.')).toBeOnTheScreen();
});

it('offers nothing for an agent with no hook', async () => {
  const screen = await render(<ScreenView text="> hello" agent="opencode" topInset={0} bottomInset={0} />);
  expect(screen.queryByTestId('install-integration')).toBeNull();
  expect(screen.queryByText(/Install HerdrChat's hook/)).toBeNull();
});
