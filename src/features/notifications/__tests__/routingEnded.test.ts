import { renderHook, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { useNotificationRouting } from '../useNotificationRouting';
import { openChat } from '@/features/chats/navigation';

const mockResponse = {
  notification: {
    request: {
      identifier: 'ended-1',
      content: { data: { workspace: 'w1', label: 'api', connection: 'conn-a', session: 'sess-old' } },
      trigger: null,
    },
  },
};

jest.mock('expo-constants', () => ({}));
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({}) }));
jest.mock('expo-notifications', () => ({
  getLastNotificationResponseAsync: () => Promise.resolve(mockResponse),
  addNotificationResponseReceivedListener: () => ({ remove: jest.fn() }),
}));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn(), push: jest.fn(), dismissTo: jest.fn() } }));
jest.mock('@/features/chats/navigation', () => ({ openChat: jest.fn() }));
jest.mock('@/features/notifications/deviceId', () => ({ getPushDeviceId: jest.fn() }));
jest.mock('@/features/notifications/mutedChats', () => ({ mutedForHost: jest.fn() }));
jest.mock('@/features/notifications/push', () => ({}));
jest.mock('@/state/Hydrate', () => ({ SELECTED_KEY: 'selected' }));
jest.mock('@/state/db', () => ({ setSetting: jest.fn() }));
jest.mock('@/state/settings', () => ({ useSettings: jest.fn() }));
jest.mock('@/state/connections', () => {
  const state = { hydrated: true, connections: [{ id: 'conn-a' }], selectedId: 'conn-a', select: jest.fn() };
  return {
    isDemo: () => false,
    // The session that pushed is no longer in its workspace.
    clientFor: () => ({ snapshot: () => Promise.resolve({ agents: [] }) }),
    useConnections: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
      getState: () => state,
    }),
  };
});

it('returns to the chats underneath when the session that pushed has ended', async () => {
  // With Hosts or Settings open as a sheet, `navigate('/')` pushed a second
  // chats screen above it instead of going back to the one underneath.
  renderHook(() => useNotificationRouting());
  await waitFor(() => expect(router.dismissTo).toHaveBeenCalledWith('/'));
  expect(router.navigate).not.toHaveBeenCalled();
  expect(openChat).not.toHaveBeenCalled();
});
