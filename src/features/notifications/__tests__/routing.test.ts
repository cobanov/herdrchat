import type * as Notifications from 'expo-notifications';

import { targetOf } from '../useNotificationRouting';

jest.mock('@/lib/herdr/sshTransport', () => ({ SshHerdrTransport: class {} }));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn(), push: jest.fn(), dismissTo: jest.fn() } }));

const response = (data: Record<string, unknown>, payload?: Record<string, unknown>) =>
  ({
    notification: {
      request: {
        identifier: 'n1',
        content: { data },
        trigger: payload === undefined ? null : { payload },
      },
    },
  }) as unknown as Notifications.NotificationResponse;

describe('targetOf (#91)', () => {
  it('reads the host and the session a push names', () => {
    expect(targetOf(response({ workspace: 'w1', label: 'api', connection: 'conn-a', session: 'sess-1' }))).toEqual({
      workspace: 'w1',
      label: 'api',
      connection: 'conn-a',
      session: 'sess-1',
    });
  });

  it('reads them from the raw APNs payload too', () => {
    expect(targetOf(response({}, { workspace: 'w2', connection: 'conn-b' }))).toMatchObject({
      workspace: 'w2',
      connection: 'conn-b',
      session: undefined,
    });
  });

  it('accepts a payload from an older watcher without them', () => {
    expect(targetOf(response({ workspace: 'w1' }))).toEqual({
      workspace: 'w1',
      label: undefined,
      connection: undefined,
      session: undefined,
    });
  });

  it('ignores a push without a workspace', () => {
    expect(targetOf(response({ label: 'api' }))).toBeNull();
  });
});
