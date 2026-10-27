import { act, fireEvent, render } from '@testing-library/react-native';

import { useHostVersion } from '@/state/hostVersion';

import { AboutSection } from '../AboutSection';

const mockUpdate = jest.fn<Promise<string | null>, []>();

jest.mock('@/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/theme/ThemeProvider', () => {
  const tokens = jest.requireActual('@/theme/tokens');
  return { useTheme: () => ({ scheme: 'light', colors: tokens.lightPalette }) };
});
jest.mock('@/components/ActionSheet', () => ({
  confirmDestructive: ({ onConfirm }: { onConfirm: () => void }) => onConfirm(),
}));
jest.mock('@/state/connections', () => ({
  useSelectedConnection: () => ({ id: 'box', name: 'Studio', host: 'studio.local' }),
  clientFor: () => ({ updateHerdr: () => mockUpdate() }),
}));

beforeEach(() => {
  mockUpdate.mockReset();
  useHostVersion.getState().setVersion('box', null);
});

// The fix the version line asks for, one tap from it: a plain `herdr update`
// on the host left the running server, the version shown here, where it was.
it('updates an outdated herdr from here, and drops the warning once the server reports the new one', async () => {
  useHostVersion.getState().setVersion('box', '0.9.1');
  mockUpdate.mockResolvedValue('0.9.5');
  const screen = await render(<AboutSection />);
  expect(screen.getByText(/0\.9\.1 ⚠︎/)).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('update-herdr')); });
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  expect(screen.getByText('0.9.5')).toBeTruthy();
  expect(screen.queryByTestId('update-herdr')).toBeNull();
});

it('says so when the server could not be moved on', async () => {
  useHostVersion.getState().setVersion('box', '0.9.1');
  mockUpdate.mockResolvedValue('0.9.1');
  const screen = await render(<AboutSection />);
  await act(async () => { fireEvent.press(screen.getByTestId('update-herdr')); });
  expect(screen.getByText(/server still runs 0\.9\.1/)).toBeTruthy();
});

it('offers nothing on a current herdr', async () => {
  useHostVersion.getState().setVersion('box', '0.9.5');
  const screen = await render(<AboutSection />);
  expect(screen.queryByTestId('update-herdr')).toBeNull();
});
