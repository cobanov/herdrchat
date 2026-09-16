import { fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import * as Native from 'react-native';

import { AdaptiveColumns } from '../AdaptiveColumns';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: { systemBackground: '#000000', separator: '#333333' } }),
}));

const originalPad = Object.getOwnPropertyDescriptor(Native.Platform, 'isPad');
const dimensions = jest.mocked(Native.useWindowDimensions);
function windowAt(width: number, isPad = true) {
  Object.defineProperty(Native.Platform, 'isPad', { configurable: true, get: () => isPad });
  dimensions.mockReturnValue({ width, height: 1024, scale: 2, fontScale: 1 });
}

afterAll(() => {
  if (originalPad) Object.defineProperty(Native.Platform, 'isPad', originalPad);
});

it.each([[375, true, false], [700, true, false], [768, true, true], [1032, true, true], [932, false, false]] as const)(
  'shows two columns at width %s only when an iPad has room', async (width, isPad, split) => {
    windowAt(width, isPad);
    const screen = await render(<AdaptiveColumns sidebar={<Native.Text>Chats</Native.Text>}><Native.Text>Detail</Native.Text></AdaptiveColumns>);
    expect(screen.queryByTestId('tablet-sidebar') !== null).toBe(split);
    expect(screen.getByText('Detail')).toBeOnTheScreen();
  }
);

it('keeps the detail draft when the sidebar disappears and returns', async () => {
  function Draft() {
    const [value, setValue] = useState('');
    return <Native.TextInput testID="draft" value={value} onChangeText={setValue} />;
  }
  const app = () => <AdaptiveColumns sidebar={<Native.Text>Chats</Native.Text>}><Draft /></AdaptiveColumns>;
  windowAt(1032);
  const screen = await render(app());
  await fireEvent.changeText(screen.getByTestId('draft'), 'Unsent message');
  windowAt(600);
  await screen.rerender(app());
  expect(screen.getByTestId('draft')).toHaveProp('value', 'Unsent message');
  expect(screen.queryByTestId('tablet-sidebar')).toBeNull();
  windowAt(1032);
  await screen.rerender(app());
  expect(screen.getByTestId('draft')).toHaveProp('value', 'Unsent message');
  expect(screen.getByTestId('tablet-sidebar')).toBeOnTheScreen();
});
