import { fireEvent, render } from '@testing-library/react-native';

import { NotificationsSection } from '../NotificationsSection';

const mockRequestPushToken = jest.fn(async () => ({ state: 'unsupported', reason: 'Test device' }));
const mockGetPushDeviceId = jest.fn(async () => 'device');
let mockConnection: { id: string } | null = { id: 'demo' };
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({}) }));
jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette }),
}));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/state/settings', () => ({
  useSettings: () => false,
  settingsSnapshot: () => ({ haptics: false }),
}));
jest.mock('@/state/connections', () => ({
  isDemo: (id: string) => id === 'demo',
  clientFor: () => ({ watcherStatus: async () => ({ kind: 'missing', manual: false }) }),
  useSelectedConnection: () => mockConnection,
  useConnections: () => [],
}));
jest.mock('@/features/notifications/deviceId', () => ({
  getPushDeviceId: () => mockGetPushDeviceId(),
}));
jest.mock('@/features/notifications/push', () => ({
  requestPushToken: () => mockRequestPushToken(),
  deviceFileId: (id: string) => id,
}));

it('does not request permission or claim registration without a real host', async () => {
  const screen = await render(<NotificationsSection />);
  for (const connection of [{ id: 'demo' }, null]) {
    mockConnection = connection;
    await screen.rerender(<NotificationsSection />);
    await fireEvent(screen.getByTestId('toggle-notifications'), 'valueChange', true);
    expect(screen.getByText('Select your own host first. The Demo host cannot send notifications.')).toBeOnTheScreen();
    expect(mockRequestPushToken).not.toHaveBeenCalled();
    expect(mockGetPushDeviceId).not.toHaveBeenCalled();
    expect(screen.getByTestId('toggle-notifications')).toHaveProp('value', false);
  }
  mockConnection = { id: 'real-host' };
  await screen.rerender(<NotificationsSection />);
  await fireEvent(screen.getByTestId('toggle-notifications'), 'valueChange', true);
  expect(mockRequestPushToken).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Test device')).toBeOnTheScreen();
});
