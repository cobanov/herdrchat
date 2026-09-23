import { DEMO_CONNECTION_ID, useConnections, type ServerConnection } from '../connections';

// The store is what is under test; the SSH transport behind `clientFor` is not.
// (Hoisted above the import by babel-jest.)
jest.mock('@/lib/herdr/sshTransport', () => ({ SshHerdrTransport: class {} }));

const host = (id: string): ServerConnection =>
  ({ id, name: id, host: `${id}.local`, port: 22, username: 'me' }) as unknown as ServerConnection;

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
