import { renderHook } from '@testing-library/react-native';

import {
  DEMO_CONNECTION_ID,
  clientFor,
  invalidateClient,
  resolveConnection,
  sshConfig,
  testClient,
  useConnectionFor,
  useConnections,
  type ServerConnection,
} from '../connections';

// The store is what is under test; the SSH transport behind `clientFor` is not.
// (Hoisted above the import by babel-jest.)
const mockCommands: string[] = [];
const mockClosed: string[] = [];
jest.mock('@/state/sshTransport', () => ({
  SshHerdrTransport: class {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
    exec = async (command: string) => {
      mockCommands.push(command);
      return { ok: true, exitCode: 0, stdout: '', stderr: '' };
    };
    close = async () => {
      mockClosed.push(this.id);
    };
  },
}));

const host = (id: string): ServerConnection =>
  ({ id, name: id, host: `${id}.local`, port: 22, username: 'me' }) as unknown as ServerConnection;

// HC-7: both native modules read an encrypted key with its passphrase, but
// the app always sent none, so such a key could not be used at all.
it('sends a private key with its passphrase, and none for a password or a blank', () => {
  const key = { ...host('k'), authKind: 'privateKey' } as ServerConnection;
  expect(sshConfig(key, 'PEM', null, 'open sesame').auth).toEqual({ kind: 'privateKey', pem: 'PEM', passphrase: 'open sesame' });
  expect(sshConfig(key, 'PEM', null, '').auth).toEqual({ kind: 'privateKey', pem: 'PEM', passphrase: null });
  expect(sshConfig(key, 'PEM', null).auth).toEqual({ kind: 'privateKey', pem: 'PEM', passphrase: null });
  expect(sshConfig({ ...key, authKind: 'password' }, 'pw', null, 'ignored').auth).toEqual({ kind: 'password', password: 'pw' });
});

describe('host selection (#90)', () => {
  it('falls back when the remembered host is no longer in the list', () => {
    useConnections.getState().setAll([host('a'), host('b')], 'deleted-host');
    expect(useConnections.getState().selectedId).toBe('a');
  });

  it('keeps a remembered host that still exists', () => {
    useConnections.getState().setAll([host('a'), host('b')], 'b');
    expect(useConnections.getState().selectedId).toBe('b');
  });

  it('selects the demo when nothing else is left', () => {
    useConnections.getState().setAll([], 'deleted-host');
    expect(useConnections.getState().selectedId).toBe(DEMO_CONNECTION_ID);
  });

  it('moves the selection off a removed host', () => {
    useConnections.getState().setAll([host('a')], 'a');
    useConnections.getState().remove('a');
    expect(useConnections.getState().selectedId).toBe(DEMO_CONNECTION_ID);
  });
});

// The connection test asked the host's default session whatever the form said,
// and reported that session's herdr (#4 acceptance).
it('tests the session the form names', async () => {
  const { client } = testClient({ ...host('a'), sessionName: 'work' }, 'secret', 'herdr');
  await client.transport.exec('true', 1000);
  expect(mockCommands.at(-1)).toContain("export HERDR_SESSION='work'");
});

// A new host landed after the Demo, between the user's own hosts.
it('adds a new host before the Demo, which stays last', () => {
  useConnections.getState().setAll([host('a')], 'a');
  useConnections.getState().upsert(host('b'));
  expect(useConnections.getState().connections.map((connection) => connection.id)).toEqual(['a', 'b', DEMO_CONNECTION_ID]);
});

describe('resolving a connection id', () => {
  beforeEach(() => {
    useConnections.getState().setAll([{ ...host('gimel'), name: 'Gimel' }], 'gimel');
  });
  afterEach(async () => {
    await invalidateClient('gimel');
  });

  it('resolves a saved host and the Demo, and nothing for a removed host', () => {
    expect(resolveConnection('gimel')?.id).toBe('gimel');
    expect(resolveConnection(DEMO_CONNECTION_ID)?.id).toBe(DEMO_CONNECTION_ID);
    expect(resolveConnection('gone')).toBeNull();
  });

  it('closes a host\'s socket once when its client is dropped, and builds a new one after', async () => {
    const before = clientFor(resolveConnection('gimel')!);
    mockClosed.length = 0;
    await invalidateClient('gimel');
    expect(mockClosed).toEqual(['gimel']);
    expect(clientFor(resolveConnection('gimel')!)).not.toBe(before);
  });

  it('resolves a host id in the hook to the host itself', async () => {
    const { result, unmount } = await renderHook(() => useConnectionFor('gimel'));
    expect(result.current?.id).toBe('gimel');
    await unmount();
    const missing = await renderHook(() => useConnectionFor(null));
    expect(missing.result.current).toBeNull();
    await missing.unmount();
  });
});
