import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { View as MockView, type ViewProps } from 'react-native';

import ServerEditScreen from '../ServerEditScreen';
import { savePassphrase } from '@/state/connections';
import { saveConnection } from '@/state/db';

const mockRouter = { back: jest.fn(), dismissAll: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: 'h1' }),
}));
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
jest.mock('@/state/db', () => ({ saveConnection: jest.fn(), setSetting: jest.fn() }));
jest.mock('@/state/Hydrate', () => ({ SELECTED_KEY: 'selected' }));
jest.mock('@/state/connections', () => {
  const state = {
    connections: [{
      id: 'h1', name: 'nuc', host: 'nuc', port: 22, username: 'me',
      authKind: 'password', herdrPath: 'herdr', sessionName: '',
    }],
    upsert: jest.fn(),
  };
  const useConnections = (pick: (s: typeof state) => unknown) => pick(state);
  return {
    useConnections,
    clearSecrets: jest.fn(),
    invalidateClient: jest.fn(),
    loadHostKeyPin: jest.fn(async () => null),
    loadPassphrase: jest.fn(async () => null),
    loadSecret: jest.fn(async () => 'hunter2'),
    saveHostKeyPin: jest.fn(),
    savePassphrase: jest.fn(),
    saveSecret: jest.fn(),
    testClient: () => ({
      client: { ping: async () => undefined, snapshot: async () => ({ version: '0.9.5' }) },
      dispose: async () => undefined,
    }),
  };
});

// Seen on a simulator build without keychain entitlements: every keychain
// write failed, Save threw inside its press handler, and nothing happened.
it('says why a host could not be saved, and stays open', async () => {
  jest.mocked(savePassphrase).mockRejectedValueOnce(new Error('Keychain access failed: A required entitlement is not present.'));
  const screen = await render(<ServerEditScreen />);
  await fireEvent.press(screen.getByTestId('test-connection'));
  await waitFor(() => expect(screen.getByTestId('test-ok')).toBeTruthy());

  await fireEvent.press(screen.getByTestId('save-server'));
  await waitFor(() => expect(screen.getByTestId('save-error'))
    .toHaveTextContent('Could not save this host. Keychain access failed: A required entitlement is not present.'));
  expect(saveConnection).not.toHaveBeenCalled();
  expect(mockRouter.dismissAll).not.toHaveBeenCalled();
});
