import { act, render } from '@testing-library/react-native';
import { useEffect } from 'react';

import { HerdrClient } from '@/lib/herdr/client';
import type { HostMachine } from '@/lib/herdr/machines';
import type { ServerConnection } from '@/state/connections';
import { useHostMachines } from '@/state/hostMachines';
import { MachineFeeds } from '../MachineChats';
import { useHostChats, useMachineFeeds, type HostChatsState } from '../useHostChats';
import type { ChatSummary } from '../useWorkspaces';

jest.mock('@/lib/herdr/sshTransport', () => ({ SshHerdrTransport: class {} }));

/** What each connection's poll answers, by connection id. */
const mockPolls = new Map<string, { summaries?: ChatSummary[]; error?: string; errorCode?: string }>();
const mockRefresh = jest.fn(async (_id: string | null) => undefined);
const mockNoRows: ChatSummary[] = [];
/** One refresh per connection, stable, as the real hook's is. */
const mockRefreshFns = new Map<string, () => Promise<undefined>>();
jest.mock('../useWorkspaces', () => ({
  useWorkspaces: (_client: unknown, connectionId: string | null) => {
    const id = connectionId ?? '';
    const poll = mockPolls.get(id) ?? {};
    if (!mockRefreshFns.has(id)) mockRefreshFns.set(id, () => mockRefresh(connectionId));
    return {
      // The real hook's rows are state, the same array until a poll changes them.
      summaries: poll.summaries ?? mockNoRows,
      loading: false,
      error: poll.error ?? null,
      errorCode: poll.errorCode ?? null,
      herdrMissing: false,
      serverStopped: false,
      refresh: mockRefreshFns.get(id),
    };
  },
}));
/** A machine's client, as a token naming its connection. */
const mockMachineClients = new Map<string, { machineClient: string }>();
jest.mock('@/state/connections', () => ({
  machineConnection: (host: { id: string }, machine: { id: string; label: string }) => ({
    kind: 'machine', id: `${host.id}/${machine.id}`, name: machine.label, via: host.id, host, machine,
  }),
  clientFor: (connection: { id: string }) => {
    if (!mockMachineClients.has(connection.id)) mockMachineClients.set(connection.id, { machineClient: connection.id });
    return mockMachineClients.get(connection.id);
  },
}));

const host = { id: 'gimel', name: 'Gimel', host: 'gimel', port: 22, username: 'me' } as ServerConnection;
const hostClient = new HerdrClient({
  exec: async () => ({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
  streamLines: async function* () { yield* []; },
});
const klaw: HostMachine = { id: 'm-klaw', label: 'klaw', target: 'klaw', session: 'default', enabled: true };

const chat = (workspaceId: string, title: string): ChatSummary => ({
  workspaceId, title, number: 1, status: 'idle', agents: [], panes: [], preview: null,
  sessionSig: null, restoreError: null, sessionTitle: null, agentName: null,
});

/** What the hook last returned, handed out after each render. */
const seen: { current: HostChatsState | null } = { current: null };
function Probe() {
  const state = useHostChats(host, hostClient);
  useEffect(() => {
    seen.current = state;
  });
  return <MachineFeeds host={host} />;
}

beforeEach(() => {
  mockPolls.clear();
  mockRefresh.mockClear();
  mockMachineClients.clear();
  useHostMachines.getState().clear('gimel');
  seen.current = null;
});

it('merges a machine\'s rows after the host\'s, each saying where it lives', async () => {
  mockPolls.set('gimel', { summaries: [chat('w1', 'herdrchat')] });
  mockPolls.set('gimel/m-klaw', { summaries: [chat('w1', 'kenneth-bot')] });
  useHostMachines.getState().set('gimel', [klaw]);
  const screen = await render(<Probe />);
  const rows = seen.current!.summaries;
  expect(rows.map((row) => [row.connectionId, row.workspaceId, row.machine?.label ?? null])).toEqual([
    ['gimel', 'w1', null],
    ['gimel/m-klaw', 'w1', 'klaw'],
  ]);
  expect(seen.current!.connectionIds).toEqual(['gimel', 'gimel/m-klaw']);
  expect(seen.current!.notices).toEqual([]);
  // A machine row's actions run on the machine's own client.
  expect(seen.current!.targetOf(rows[1]!)).toEqual({ client: mockMachineClients.get('gimel/m-klaw'), connectionId: 'gimel/m-klaw' });
  expect(seen.current!.targetOf(rows[0]!)).toEqual({ client: hostClient, connectionId: 'gimel' });
  // A pull refreshes the host and the machine.
  await act(() => seen.current!.refresh());
  expect(mockRefresh.mock.calls.map(([id]) => id).sort()).toEqual(['gimel', 'gimel/m-klaw']);
  await screen.unmount();
  expect(useMachineFeeds.getState().feeds).toEqual({});
});

// The host answered; one machine behind it did not. The list keeps the host's
// rows, says nothing about it as the list's error, and gives the machine one
// line naming it.
it('leaves the host\'s rows and error alone when a machine fails, and sets its notice', async () => {
  mockPolls.set('gimel', { summaries: [chat('w1', 'herdrchat')] });
  mockPolls.set('gimel/m-klaw', {
    summaries: [chat('w1', 'kenneth-bot')],
    error: "Gimel can't reach klaw right now.",
    errorCode: 'connect_failed',
  });
  useHostMachines.getState().set('gimel', [klaw]);
  const screen = await render(<Probe />);
  expect(seen.current!.error).toBeNull();
  expect(seen.current!.summaries.map((row) => row.connectionId)).toEqual(['gimel', 'gimel/m-klaw']);
  expect(seen.current!.notices).toEqual([{ machineId: 'm-klaw', label: 'klaw', text: "Gimel can't reach klaw right now." }]);
  await screen.unmount();
});

// A host that is down takes its machines with it; their notices would repeat it.
it('says nothing about machines while the host itself is failing', async () => {
  mockPolls.set('gimel', { error: 'Host down', errorCode: 'connect_failed' });
  mockPolls.set('gimel/m-klaw', { error: 'Host down', errorCode: 'connect_failed' });
  useHostMachines.getState().set('gimel', [klaw]);
  const screen = await render(<Probe />);
  expect(seen.current!.error).toBe('Host down');
  expect(seen.current!.notices).toEqual([]);
  await screen.unmount();
});

it('drops a machine\'s rows once the host lists it as disabled', async () => {
  mockPolls.set('gimel', { summaries: [chat('w1', 'herdrchat')] });
  mockPolls.set('gimel/m-klaw', { summaries: [chat('w1', 'kenneth-bot')] });
  useHostMachines.getState().set('gimel', [klaw]);
  const screen = await render(<Probe />);
  expect(seen.current!.summaries).toHaveLength(2);
  await act(async () => {
    useHostMachines.getState().set('gimel', [{ ...klaw, enabled: false }]);
  });
  expect(seen.current!.summaries.map((row) => row.connectionId)).toEqual(['gimel']);
  expect(seen.current!.connectionIds).toEqual(['gimel']);
  expect(useMachineFeeds.getState().feeds).toEqual({});
  await screen.unmount();
});
