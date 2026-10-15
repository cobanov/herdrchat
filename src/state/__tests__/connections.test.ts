import { act, renderHook } from '@testing-library/react-native';

import { sshJump } from '@/lib/herdr/machine';
import type { HostMachine } from '@/lib/herdr/machines';
import {
  DEMO_CONNECTION_ID,
  clientFor,
  demoConnection,
  invalidateClient,
  isMachineConnection,
  machineConnection,
  resolveConnection,
  testClient,
  useConnectionFor,
  useConnections,
  type ServerConnection,
} from '../connections';
import { resetHostMachinesSession, useHostMachines } from '../hostMachines';

// The store is what is under test; the SSH transport behind `clientFor` is not.
// (Hoisted above the import by babel-jest.)
const mockCommands: string[] = [];
const mockClosed: string[] = [];
jest.mock('@/lib/herdr/sshTransport', () => ({
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

// MARK: - Machines

const klaw: HostMachine = { id: 'm-klaw', label: 'klaw', target: 'klaw', session: 'work', enabled: true };
const off: HostMachine = { id: 'm-off', label: 'off', target: 'off', session: 'default', enabled: false };

describe('machine connections', () => {
  beforeEach(() => {
    resetHostMachinesSession();
    useConnections.getState().setAll([{ ...host('gimel'), name: 'Gimel', sessionName: '', herdrPath: '/opt/bin/herdr' }], 'gimel');
    useHostMachines.getState().set('gimel', [klaw, off]);
  });
  afterEach(async () => {
    await invalidateClient('gimel');
    await invalidateClient(DEMO_CONNECTION_ID);
  });

  it('resolves a saved host, the Demo, and an enabled machine of a saved host', () => {
    expect(resolveConnection('gimel')?.id).toBe('gimel');
    expect(resolveConnection(DEMO_CONNECTION_ID)?.id).toBe(DEMO_CONNECTION_ID);
    const machine = resolveConnection('gimel/m-klaw');
    expect(machine !== null && isMachineConnection(machine)).toBe(true);
    expect(machine).toMatchObject({ id: 'gimel/m-klaw', name: 'klaw', via: 'gimel', machine: klaw });
  });

  it('resolves nothing for a removed host, an unlisted or disabled machine, or a machine of a removed host', () => {
    expect(resolveConnection('gone')).toBeNull();
    expect(resolveConnection('gimel/m-unknown')).toBeNull();
    expect(resolveConnection('gimel/m-off')).toBeNull();
    expect(resolveConnection('gone/m-klaw')).toBeNull();
  });

  // The machine is reached through the host's own `ssh`, on the host's one
  // connection, with the session exported on the machine rather than the host.
  it('builds a machine\'s client on the host\'s transport, jumped, then bound to its session', async () => {
    const connection = resolveConnection('gimel/m-klaw')!;
    const client = clientFor(connection);
    expect(clientFor(connection)).toBe(client);
    await client.transport.exec('true', 1000);
    const sent = mockCommands.at(-1)!;
    expect(sent).toContain(sshJump('klaw', "export HERDR_SESSION='work'; true"));
    expect(sent.startsWith('export HERDR_SESSION')).toBe(false);
  });

  it('runs herdr by name on the machine, not at the host\'s path', async () => {
    const client = clientFor(resolveConnection('gimel/m-klaw')!);
    await client.machines();
    const sent = mockCommands.at(-1)!;
    expect(sent).toContain("'klaw'");
    expect(sent).toContain('machine');
    expect(sent).not.toContain('/opt/bin/herdr');
  });

  it('drops a host\'s machine clients with the host\'s, and closes the host\'s socket once', async () => {
    const connection = resolveConnection('gimel/m-klaw')!;
    const before = clientFor(connection);
    mockClosed.length = 0;
    await invalidateClient('gimel');
    expect(mockClosed).toEqual(['gimel']);
    expect(clientFor(connection)).not.toBe(before);
  });

  it('rebuilds a machine\'s client when the host lists it at a new target', () => {
    const before = clientFor(resolveConnection('gimel/m-klaw')!);
    useHostMachines.getState().set('gimel', [{ ...klaw, target: 'klaw.tail' }, off]);
    expect(clientFor(resolveConnection('gimel/m-klaw')!)).not.toBe(before);
  });

  // The Demo's machine rides on the Demo host's own instance, which unwraps the
  // jump with the same builder, so the machine's fictional state is shared.
  it('answers the Demo machine\'s snapshot through the Demo host', async () => {
    const demo = demoConnection();
    const host = clientFor(demo);
    const { machines } = await host.machines();
    const nuku = machines.find((machine) => machine.label === 'nuku')!;
    const client = clientFor(machineConnection(demo, nuku));
    const snapshot = await client.snapshot();
    expect(snapshot.workspaces?.map((workspace) => workspace.label)).toEqual(['kenneth-bot']);
  });

  it('keeps a machine connection stable across a refresh that changed nothing, and drops it when disabled', async () => {
    const { result, unmount } = await renderHook(() => useConnectionFor('gimel/m-klaw'));
    const first = result.current;
    expect(first?.name).toBe('klaw');
    await act(async () => useHostMachines.getState().set('gimel', [{ ...klaw }, { ...off }]));
    expect(result.current).toBe(first);
    await act(async () => useHostMachines.getState().set('gimel', [{ ...klaw, enabled: false }]));
    expect(result.current).toBeNull();
    await unmount();
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
