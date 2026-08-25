import * as Notifications from 'expo-notifications';

import { existingPushToken, requestPushToken } from '../push';

/**
 * Asking iOS for notification permission is a one-shot: decline it and the only
 * way back is the Settings app. So which of these two functions a caller picks
 * is not a style choice, and both wrong callers shipped — the launch refresh and
 * the Settings opt-OUT path, the second of which could ask to turn notifications
 * on while the user was turning them off.
 */

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
  IosAuthorizationStatus: { PROVISIONAL: 3 },
}));

const mocked = Notifications as jest.Mocked<typeof Notifications>;

const permissions = (granted: boolean) =>
  ({ granted, ios: { status: granted ? 2 : 0 } }) as unknown as Notifications.NotificationPermissionsStatus;

beforeEach(() => {
  jest.clearAllMocks();
  mocked.getDevicePushTokenAsync.mockResolvedValue({ type: 'ios', data: 'tok' });
});

describe('existingPushToken', () => {
  it('never asks, even when permission has not been granted', async () => {
    mocked.getPermissionsAsync.mockResolvedValue(permissions(false));

    await expect(existingPushToken()).resolves.toEqual({ state: 'denied' });
    expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns the token when permission is already there', async () => {
    mocked.getPermissionsAsync.mockResolvedValue(permissions(true));

    await expect(existingPushToken()).resolves.toEqual({ state: 'granted', token: 'tok' });
    expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('requestPushToken', () => {
  it('does ask when permission is missing — this is the toggle-on path', async () => {
    mocked.getPermissionsAsync.mockResolvedValue(permissions(false));
    mocked.requestPermissionsAsync.mockResolvedValue(permissions(true));

    await expect(requestPushToken()).resolves.toEqual({ state: 'granted', token: 'tok' });
    expect(mocked.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('does not ask again when permission is already granted', async () => {
    mocked.getPermissionsAsync.mockResolvedValue(permissions(true));

    await expect(requestPushToken()).resolves.toEqual({ state: 'granted', token: 'tok' });
    expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});
