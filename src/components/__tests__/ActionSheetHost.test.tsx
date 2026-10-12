import 'react-native-gesture-handler/jestSetup';
import { act, fireEvent, render } from '@testing-library/react-native';
import { BackHandler, Platform, type HardwareBackPressEvent } from 'react-native';

import { confirmDestructive, showActionSheet } from '../ActionSheet';
import { ActionSheetHost } from '../ActionSheetHost';
import { useActionSheet } from '@/state/actionSheet';

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 24, left: 0 }),
}));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').lightPalette, reduceMotion: false }),
}));

const originalOS = Object.getOwnPropertyDescriptor(Platform, 'OS');
beforeEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
  useActionSheet.setState({ sheet: null });
});
afterEach(() => {
  if (originalOS) Object.defineProperty(Platform, 'OS', originalOS);
  jest.restoreAllMocks();
});

/** The exit animation hands back to JS in a microtask; let it land. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

function chatSheet(handlers: Record<string, jest.Mock>) {
  showActionSheet({
    title: 'notes',
    actions: [
      { label: 'Pin', onPress: handlers.pin! },
      { label: 'Mute notifications', onPress: handlers.mute! },
      { label: 'Close chat', destructive: true, onPress: handlers.close! },
      { label: 'Rename…', onPress: handlers.rename! },
    ],
  });
}

// Android used Alert.alert, which keeps three buttons: a chat's long press lost
// Close chat and Cancel, and with Back ignored, picking an action was the only
// way out.
it('shows every action and Cancel, destructive below the safe ones', async () => {
  const handlers = { pin: jest.fn(), mute: jest.fn(), close: jest.fn(), rename: jest.fn() };
  const screen = await render(<ActionSheetHost />);
  await act(async () => chatSheet(handlers));

  const labels = ['Pin', 'Mute notifications', 'Rename…', 'Close chat', 'Cancel'];
  for (const label of labels) expect(screen.getByText(label)).toBeOnTheScreen();
  expect(screen.getByTestId('action-sheet-option-3')).toHaveProp('accessibilityLabel', 'Close chat');
  expect(screen.getByTestId('action-sheet-cancel')).toBeOnTheScreen();
});

// As on iOS: Rename… opens a sheet of its own, which must not come up under
// this one still leaving.
it('runs the chosen action once, after the sheet has gone', async () => {
  let openWhenRun: unknown = 'not run';
  const handlers = {
    pin: jest.fn(),
    mute: jest.fn(),
    close: jest.fn(),
    rename: jest.fn(() => {
      openWhenRun = useActionSheet.getState().sheet;
    }),
  };
  const screen = await render(<ActionSheetHost />);
  await act(async () => chatSheet(handlers));

  await fireEvent.press(screen.getByText('Rename…'));
  await settle();

  expect(handlers.rename).toHaveBeenCalledTimes(1);
  expect(openWhenRun).toBeNull();
  expect(handlers.pin).not.toHaveBeenCalled();
  expect(screen.queryByTestId('action-sheet')).toBeNull();
});

// Close chat asks to confirm from inside the first sheet's action.
it('opens a sheet from another sheet’s action', async () => {
  const onConfirm = jest.fn();
  const screen = await render(<ActionSheetHost />);
  await act(async () =>
    showActionSheet({
      title: 'notes',
      actions: [{
        label: 'Close chat',
        destructive: true,
        onPress: () => confirmDestructive({ title: 'Close notes?', confirmLabel: 'Close chat', onConfirm }),
      }],
    })
  );
  await fireEvent.press(screen.getByText('Close chat'));
  await settle();

  expect(screen.getByText('Close notes?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('Close chat'));
  await settle();
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

it('leaves on Back, Cancel or a tap on the dim without running anything', async () => {
  let back: ((event: HardwareBackPressEvent) => boolean | null | undefined) | undefined;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    back = handler;
    return { remove: jest.fn() };
  });
  const handlers = { pin: jest.fn(), mute: jest.fn(), close: jest.fn(), rename: jest.fn() };
  const screen = await render(<ActionSheetHost />);

  for (const leave of [
    () => act(async () => {
      expect(back?.({} as HardwareBackPressEvent)).toBe(true);
    }),
    () => fireEvent.press(screen.getByTestId('action-sheet-cancel')),
    () => fireEvent.press(screen.getByTestId('action-sheet-scrim')),
  ]) {
    await act(async () => chatSheet(handlers));
    expect(screen.getByTestId('action-sheet')).toBeOnTheScreen();
    await leave();
    await settle();
    expect(screen.queryByTestId('action-sheet')).toBeNull();
  }
  for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
});

it('draws nothing on iOS, whose sheet is the system’s', async () => {
  if (originalOS) Object.defineProperty(Platform, 'OS', originalOS);
  useActionSheet.getState().present({
    title: 'notes',
    config: { options: ['Pin', 'Cancel'], handlers: [jest.fn(), jest.fn()], destructiveButtonIndices: [], cancelButtonIndex: 1 },
  });
  const screen = await render(<ActionSheetHost />);
  expect(screen.queryByTestId('action-sheet')).toBeNull();
});
