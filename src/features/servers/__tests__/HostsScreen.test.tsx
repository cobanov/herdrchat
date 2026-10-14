import { act, render } from '@testing-library/react-native';
import { View as MockView, type ViewProps } from 'react-native';

import HostsScreen from '../HostsScreen';
import { useBadge } from '@/state/badge';

// What is under test is the link between the attention store and the sheet's
// Done: the chats list publishes the count, and Hosts has to read it and show
// it. Header's own rendering of a count is pinned in Header.test.tsx.
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({}) }));
jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: ViewProps) => <MockView {...props} />,
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette }),
}));
jest.mock('@/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/components/ActionSheet', () => ({ confirmDestructive: jest.fn() }));
jest.mock('@/features/chats/navigation', () => ({ returnToChats: jest.fn() }));
jest.mock('@/features/notifications/deviceId', () => ({ getPushDeviceId: jest.fn() }));
jest.mock('@/features/notifications/push', () => ({ deviceFileId: jest.fn(), removePushToken: jest.fn() }));
jest.mock('@/state/db', () => ({ clearConnectionSettings: jest.fn(), deleteConnection: jest.fn(), setSetting: jest.fn() }));
jest.mock('@/state/Hydrate', () => ({ SELECTED_KEY: 'selected' }));
jest.mock('@/state/connections', () => {
  const state = {
    connections: [{ id: 'demo', name: 'Demo' }],
    selectedId: 'demo',
    select: jest.fn(),
    remove: jest.fn(),
  };
  const useConnections = (pick: (s: typeof state) => unknown) => pick(state);
  useConnections.getState = () => state;
  return {
    useConnections,
    clearSecrets: jest.fn(),
    clientFor: jest.fn(),
    DEMO_CONNECTION_ID: 'demo',
    invalidateClient: jest.fn(),
    isDemo: (id: string) => id === 'demo',
    newConnection: () => ({ id: 'new' }),
  };
});

afterEach(() => useBadge.getState().setCount(0));

it('shows the chats list’s attention count beside Done, and follows it', async () => {
  useBadge.getState().setCount(2);
  const screen = await render(<HostsScreen />);
  expect(screen.getByTestId('header-close-badge')).toHaveTextContent('2');

  await act(async () => useBadge.getState().setCount(0));
  expect(screen.queryByTestId('header-close-badge')).toBeNull();
});
