import { act, fireEvent, render } from '@testing-library/react-native';

import { AGENT_PROMPT } from '@/lib/theme/bootstrap';
import { resolveHostTheme } from '@/lib/theme/resolve';
import { useHostTheme } from '@/state/hostTheme';
import { darkPalette, lightPalette } from '@/theme/tokens';

import { HostThemeSection } from '../HostThemeSection';

const mockReload = jest.fn(async (_id: string) => true);
const mockReset = jest.fn(async (_id: string) => true);
const mockSetString = jest.fn(async (_text: string) => true);
const mockSaveSetting = jest.fn();
let mockEnabled = true;

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({}) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: (text: string) => mockSetString(text) }));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette }),
}));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/components/ActionSheet', () => ({
  confirmDestructive: ({ onConfirm }: { onConfirm: () => void }) => onConfirm(),
}));
jest.mock('@/state/settings', () => ({
  useSettings: (select: (state: { useHostThemes: boolean }) => unknown) => select({ useHostThemes: mockEnabled }),
  settingsSnapshot: () => ({ haptics: false }),
}));
jest.mock('@/state/saveSetting', () => ({ saveSetting: (...args: unknown[]) => mockSaveSetting(...args) }));
jest.mock('@/state/connections', () => ({
  useSelectedConnection: () => ({ id: 'box', name: 'Studio', host: 'studio.local' }),
}));
jest.mock('@/state/hostThemeActions', () => ({
  reloadHostTheme: (id: string) => mockReload(id),
  resetHostThemeToDefault: (id: string) => mockReset(id),
}));

const present = (text: string) =>
  resolveHostTheme({ kind: 'present', mtime: 1, text }, { light: lightPalette, dark: darkPalette });

beforeEach(() => {
  mockEnabled = true;
  useHostTheme.getState().clear('box');
  jest.clearAllMocks();
});

it('says Default for a host not yet checked, and names a theme once one arrives', async () => {
  const screen = await render(<HostThemeSection />);
  expect(screen.getByTestId('host-theme-row')).toHaveProp('accessibilityLabel', 'Host theme, Default');
  await act(() => useHostTheme.getState().set('box', present('{"name":"Warm","accent":"#D08A3E"}')));
  expect(screen.getByTestId('host-theme-row')).toHaveProp('accessibilityLabel', 'Host theme, Warm, 1 colour from Studio');
});

it('opens onto the path and the problems verbatim, and its three actions reach the host', async () => {
  useHostTheme.getState().set('box', present('{"accent":"#D08A3E","light":{"tnit":"#000"}}'));
  const screen = await render(<HostThemeSection />);
  expect(screen.queryByTestId('host-theme-reload')).toBeNull();
  await fireEvent.press(screen.getByTestId('host-theme-row'));
  expect(screen.getByText('~/.herdrchat/theme.json on Studio')).toBeOnTheScreen();
  expect(screen.getByText('light.tnit: not a palette key, ignored')).toBeOnTheScreen();

  await fireEvent.press(screen.getByTestId('host-theme-reload'));
  expect(mockReload).toHaveBeenCalledWith('box');
  await fireEvent.press(screen.getByTestId('host-theme-copy'));
  expect(mockSetString).toHaveBeenCalledWith(AGENT_PROMPT);
  expect(screen.getByText('Copied')).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('host-theme-reset'));
  expect(mockReset).toHaveBeenCalledWith('box');
});

it('says when the host did not answer', async () => {
  mockReload.mockResolvedValueOnce(false);
  const screen = await render(<HostThemeSection />);
  await fireEvent.press(screen.getByTestId('host-theme-row'));
  await fireEvent.press(screen.getByTestId('host-theme-reload'));
  expect(screen.getByText(/Studio did not answer/)).toBeOnTheScreen();
});

it('says Off with the switch off, and the switch saves the global setting', async () => {
  mockEnabled = false;
  useHostTheme.getState().set('box', present('{"name":"Warm","accent":"#D08A3E"}'));
  const screen = await render(<HostThemeSection />);
  expect(screen.getByTestId('host-theme-row')).toHaveProp('accessibilityLabel', 'Host theme, Off');
  await fireEvent(screen.getByTestId('toggle-host-themes'), 'valueChange', true);
  expect(mockSaveSetting).toHaveBeenCalledWith({}, 'useHostThemes', true);
});
