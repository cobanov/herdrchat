import { fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import * as Native from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AdaptiveColumns } from '../AdaptiveColumns';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: { systemBackground: '#000000', separator: '#333333' } }),
}));
// Each column is a safe-area provider; the real one waits for native insets.
jest.mock('react-native-safe-area-context', () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default);

let mockModelId: string | null = null;
jest.mock('../../../modules/herdr-device/src', () => ({ deviceModelId: () => mockModelId }));

const originalPad = Object.getOwnPropertyDescriptor(Native.Platform, 'isPad');
const dimensions = jest.mocked(Native.useWindowDimensions);
function windowAt(width: number, isPad = true, modelId: string | null = null) {
  Object.defineProperty(Native.Platform, 'isPad', { configurable: true, get: () => isPad });
  mockModelId = modelId;
  dimensions.mockReturnValue({ width, height: 1024, scale: 2, fontScale: 1 });
}

afterAll(() => {
  if (originalPad) Object.defineProperty(Native.Platform, 'isPad', originalPad);
});

const columns = () => <AdaptiveColumns sidebar={<Native.Text>Chats</Native.Text>}><Native.Text>Detail</Native.Text></AdaptiveColumns>;

it.each([[375, true, false], [600, true, false], [700, true, true], [768, true, true], [1032, true, true], [932, false, false]] as const)(
  'shows two columns at width %s only when an iPad has room', async (width, isPad, split) => {
    windowAt(width, isPad);
    const screen = await render(columns());
    expect(screen.queryByTestId('tablet-sidebar') !== null).toBe(split);
    expect(screen.getByText('Detail')).toBeOnTheScreen();
  }
);

// The iPhone Duo is the phone idiom: only its model says it unfolds.
it.each([[466, false], [669, true]] as const)(
  'gives an iPhone Duo two columns open and one folded (width %s)', async (width, split) => {
    windowAt(width, false, 'iPhone19,4');
    const screen = await render(columns());
    expect(screen.queryByTestId('tablet-sidebar') !== null).toBe(split);
  }
);

it('never splits another iPhone, however wide its window', async () => {
  windowAt(956, false, 'iPhone19,1');
  const screen = await render(columns());
  expect(screen.queryByTestId('tablet-sidebar')).toBeNull();
});

// The Duo's strip on the right edge reserved its width beside the chats on the
// left: both columns read the window's insets. Each column measures its own
// (natively; jest's provider starts every column at zero insets).
it('gives each column its own insets rather than the window\'s', async () => {
  function Inset({ label }: { label: string }) {
    return <Native.Text>{`${label} ${useSafeAreaInsets().right}`}</Native.Text>;
  }
  const strip = { frame: { x: 0, y: 0, width: 951, height: 669 }, insets: { top: 0, bottom: 0, left: 0, right: 100 } };
  windowAt(951, false, 'iPhone19,4');
  const screen = await render(
    <SafeAreaProvider initialMetrics={strip}>
      <Inset label="window" />
      <AdaptiveColumns sidebar={<Inset label="sidebar" />}><Inset label="detail" /></AdaptiveColumns>
    </SafeAreaProvider>
  );
  expect(screen.getByText('window 100')).toBeOnTheScreen();
  expect(screen.getByText('sidebar 0')).toBeOnTheScreen();
  expect(screen.getByText('detail 0')).toBeOnTheScreen();
});

it('narrows the sidebar below an iPad width', async () => {
  windowAt(669, false, 'iPhone19,4');
  const screen = await render(columns());
  expect(screen.getByTestId('tablet-sidebar')).toHaveStyle({ width: 280 });
  windowAt(1032);
  await screen.rerender(columns());
  expect(screen.getByTestId('tablet-sidebar')).toHaveStyle({ width: 320 });
});

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
