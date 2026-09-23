import { DEMO_CONNECTION_ID, testClient, useConnections, type ServerConnection } from '../connections';

// The store is what is under test; the SSH transport behind `clientFor` is not.
// (Hoisted above the import by babel-jest.)
const mockCommands: string[] = [];
jest.mock('@/lib/herdr/sshTransport', () => ({
  SshHerdrTransport: class {
    exec = async (command: string) => {
      mockCommands.push(command);
      return { ok: true, exitCode: 0, stdout: '', stderr: '' };
    };
  },
}));

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

// The connection test asked the host's default session whatever the form said,
// and reported that session's herdr (#4 acceptance).
it('tests the session the form names', async () => {
  const { client } = testClient({ ...host('a'), sessionName: 'work' }, 'secret', 'herdr');
  await client.transport.exec('true', 1000);
  expect(mockCommands.at(-1)).toContain("export HERDR_SESSION='work'");
});
