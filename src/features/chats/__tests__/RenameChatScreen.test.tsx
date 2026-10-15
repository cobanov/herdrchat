import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { View as MockView, type ViewProps } from 'react-native';

import RenameChatScreen from '../RenameChatScreen';

const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: ViewProps) => <MockView {...props} />,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/theme/tokens').darkPalette, reduceMotion: true }),
}));
jest.mock('@/lib/haptics', () => ({ haptics: { success: jest.fn(), error: jest.fn() } }));

/** One client per connection, each recording its renames. */
const mockRenames: { connectionId: string; workspaceId: string; label: string }[] = [];
const mockHost = { id: 'gimel', name: 'Gimel' };
const mockKlaw = { kind: 'machine', id: 'gimel/m-klaw', name: 'klaw', via: 'gimel' };
jest.mock('@/state/connections', () => ({
  useSelectedConnection: () => mockHost,
  useConnectionFor: (id: string | null) => (id === mockKlaw.id ? mockKlaw : id === mockHost.id ? mockHost : null),
  clientFor: (connection: { id: string }) => ({
    renameWorkspace: async (workspaceId: string, label: string) => {
      mockRenames.push({ connectionId: connection.id, workspaceId, label });
    },
  }),
}));

beforeEach(() => {
  mockRenames.length = 0;
  mockBack.mockClear();
});

async function rename(to: string) {
  const screen = await render(<RenameChatScreen />);
  await fireEvent.changeText(screen.getByTestId('field-rename'), to);
  await fireEvent.press(screen.getByTestId('save-rename'));
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  return screen;
}

// The host's w1 and klaw's w1 are two chats. Renamed through the selected
// host, klaw's would have renamed the host's.
it('renames a machine\'s workspace on the machine, from the route', async () => {
  mockParams = { workspaceId: 'w1', title: 'kenneth-bot', connectionId: 'gimel/m-klaw' };
  const screen = await rename('bot');
  expect(mockRenames).toEqual([{ connectionId: 'gimel/m-klaw', workspaceId: 'w1', label: 'bot' }]);
  expect(screen.getByText(/renames the workspace on klaw/)).toBeOnTheScreen();
});

it('renames on the selected host when the link names no connection', async () => {
  mockParams = { workspaceId: 'w1', title: 'notes' };
  await rename('release notes');
  expect(mockRenames).toEqual([{ connectionId: 'gimel', workspaceId: 'w1', label: 'release notes' }]);
});
