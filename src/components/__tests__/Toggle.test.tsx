import { fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { Toggle } from '../Toggle';

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').lightPalette, reduceMotion: true }),
}));
jest.mock('@/components/haptics', () => ({ haptics: { selection: jest.fn() } }));

const originalOS = Object.getOwnPropertyDescriptor(Platform, 'OS');
afterEach(() => {
  if (originalOS) Object.defineProperty(Platform, 'OS', originalOS);
});

// React Native's Android switch is the older one, its knob hanging off a thin
// track and the off state nearly invisible on a light card.
it('draws a Material switch on Android that reads and flips like a switch', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
  const onChange = jest.fn();
  const screen = await render(<Toggle label="Haptics" detail="Feedback" value={false} onChange={onChange} testID="toggle" />);

  const control = screen.getByTestId('toggle');
  // Not the platform switch, which takes `value`.
  expect(control.props.value).toBeUndefined();
  expect(control).toHaveProp('accessibilityRole', 'switch');
  expect(control).toHaveProp('accessibilityState', { checked: false, disabled: false });
  expect(control).toHaveProp('accessibilityLabel', 'Haptics');

  await fireEvent.press(control);
  expect(onChange).toHaveBeenCalledWith(true);

  await screen.rerender(<Toggle label="Haptics" value onChange={onChange} disabled testID="toggle" />);
  expect(screen.getByTestId('toggle')).toHaveProp('accessibilityState', { checked: true, disabled: true });
});

it('keeps the system switch on iOS', async () => {
  const screen = await render(<Toggle label="Haptics" value onChange={jest.fn()} testID="toggle" />);
  expect(screen.getByTestId('toggle')).toHaveProp('value', true);
});
