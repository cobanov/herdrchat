import { fireEvent, render } from '@testing-library/react-native';
import { ScrollView } from 'react-native';

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

// On a real host the install button sat above a live screen, and each poll's
// new screen pulled a reader who had scrolled up to it back to the end.
it('stays at the end only while the reader is there', async () => {
  const toEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  const screen = await render(<ScreenView text="> one" agent="Gemini" topInset={0} bottomInset={0} onInstall={jest.fn()} />);
  const view = screen.getByTestId('agent-screen');
  const at = (y: number) => ({ nativeEvent: { contentOffset: { x: 0, y }, contentSize: { width: 400, height: 2000 }, layoutMeasurement: { width: 400, height: 800 } } });
  await fireEvent(view, 'contentSizeChange', 400, 2000);
  expect(toEnd).toHaveBeenCalledTimes(1);
  // Scrolled up to the top, where the button is: a new screen leaves them there.
  await fireEvent(view, 'scrollEndDrag', at(0));
  await fireEvent(view, 'contentSizeChange', 400, 2100);
  expect(toEnd).toHaveBeenCalledTimes(1);
  // Back at the end: followed again.
  await fireEvent(view, 'scrollEndDrag', at(1200));
  await fireEvent(view, 'contentSizeChange', 400, 2200);
  expect(toEnd).toHaveBeenCalledTimes(2);
  toEnd.mockRestore();
});
