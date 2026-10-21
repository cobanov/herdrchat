import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { PUSH_CHANNEL, requestPushToken, uploadPushToken } from '../push';
import type { HerdrTransport } from '@/lib/herdr/transport';

// Android had no push at all: the switch was hidden and this said "iOS-only".
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { HIGH: 4 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
}));

const mocked = Notifications as jest.Mocked<typeof Notifications>;
const os = Platform.OS;
beforeAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' }));
afterAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os }));
beforeEach(() => jest.clearAllMocks());

it('makes the channel the relay names before asking, then returns the FCM token', async () => {
  const order: string[] = [];
  mocked.setNotificationChannelAsync.mockImplementation(async () => (order.push('channel'), null));
  mocked.getPermissionsAsync.mockImplementation(async () => (order.push('check'), { granted: false } as Notifications.NotificationPermissionsStatus));
  mocked.requestPermissionsAsync.mockResolvedValue({ granted: true } as Notifications.NotificationPermissionsStatus);
  mocked.getDevicePushTokenAsync.mockResolvedValue({ type: 'android', data: 'fcm:token' });

  await expect(requestPushToken()).resolves.toEqual({ state: 'granted', token: 'fcm:token' });
  expect(order).toEqual(['channel', 'check']);
  expect(mocked.setNotificationChannelAsync).toHaveBeenCalledWith(PUSH_CHANNEL, expect.objectContaining({ importance: 4 }));
});

it('says what to check when a build has no Firebase file', async () => {
  mocked.getPermissionsAsync.mockResolvedValue({ granted: true } as Notifications.NotificationPermissionsStatus);
  mocked.getDevicePushTokenAsync.mockRejectedValue(new Error('Default FirebaseApp is not initialized'));

  await expect(requestPushToken()).resolves.toEqual({
    state: 'unsupported',
    reason: expect.stringContaining('Firebase file'),
    detail: 'Default FirebaseApp is not initialized',
  });
});

it('marks the token file as FCM, which the watcher sends through the relay', async () => {
  const commands: string[] = [];
  const transport: HerdrTransport = {
    exec: async (command: string) => (commands.push(command), { ok: true, exitCode: 0, stdout: '', stderr: '' }),
    streamLines: async function* () {},
  };
  await uploadPushToken(transport, 'device-1', 'fcm:token', 'dev.herdr.herdrchat', 'conn-1');
  expect(commands[0]).toContain('"service":"fcm"');
});
