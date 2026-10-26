import { act, render } from '@testing-library/react-native';
import { useEffect } from 'react';

import { HerdrClient } from '@/lib/herdr/client';
import { useConnections, type ServerConnection } from '@/state/connections';
import { HostFeeds } from '../HostFeeds';
import { useHostChats, useHostFeeds, type HostChatsState } from '../useHostChats';
import type { ChatSummary } from '../useWorkspaces';

jest.mock('@/state/sshTransport', () => ({ SshHerdrTransport: class {} }));

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
/** Another host's client, as a token naming it. */
const mockClients = new Map<string, { client: string }>();
jest.mock('@/state/connections', () => ({
  useConnections: jest.requireActual<typeof import('zustand')>('zustand').create(() => ({ connections: [] as unknown[] })),
  isDemo: (id: string) => id === 'demo',
  clientFor: (connection: { id: string }) => {
    if (!mockClients.has(connection.id)) mockClients.set(connection.id, { client: connection.id });
    return mockClients.get(connection.id);
  },
}));

const saved = (id: string, name: string) => ({ id, name, host: id, port: 22, username: 'me' } as ServerConnection);
const host = saved('gimel', 'Gimel');
const mac = saved('mac', 'MacBook');
const demo = saved('demo', 'Demo');
const hostClient = new HerdrClient({
  exec: async () => ({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
  streamLines: async function* () { yield* []; },
});

const chat = (workspaceId: string, title: string): ChatSummary => ({
  workspaceId, title, number: 1, status: 'idle', agents: [], panes: [], preview: null,
  sessionSig: null, shellPanes: [], tabs: [], layouts: [], activeTabId: null, tabCount: 0, paneCount: 0, restoreError: null, sessionTitle: null, agentName: null,
});

/** What the hook last returned, handed out after each render. */
const seen: { current: HostChatsState | null } = { current: null };
function Probe({ selected = host }: { selected?: ServerConnection }) {
  const state = useHostChats(selected, hostClient);
  useEffect(() => {
    seen.current = state;
  });
  return <HostFeeds selectedId={selected.id} />;
}

beforeEach(() => {
  mockPolls.clear();
  mockRefresh.mockClear();
  mockClients.clear();
  useConnections.setState({ connections: [host, mac, demo] });
  seen.current = null;
});

it('merges every other saved host\'s rows after the selected one\'s, each saying where it lives', async () => {
  mockPolls.set('gimel', { summaries: [chat('w1', 'herdrchat')] });
  mockPolls.set('mac', { summaries: [chat('w1', 'kenneth-bot')] });
  const screen = await render(<Probe />);
  const rows = seen.current!.summaries;
  // The Demo joins no real host's list.
  expect(rows.map((row) => [row.connectionId, row.workspaceId, row.host?.label ?? null])).toEqual([
    ['gimel', 'w1', null],
    ['mac', 'w1', 'MacBook'],
  ]);
  expect(seen.current!.connectionIds).toEqual(['gimel', 'mac']);
  expect(seen.current!.notices).toEqual([]);
  // Another host's row runs its actions on that host's own client.
  expect(seen.current!.targetOf(rows[1]!)).toEqual({ client: mockClients.get('mac'), connectionId: 'mac' });
  expect(seen.current!.targetOf(rows[0]!)).toEqual({ client: hostClient, connectionId: 'gimel' });
  // A pull refreshes every host.
  await act(() => seen.current!.refresh());
  expect(mockRefresh.mock.calls.map(([id]) => id).sort()).toEqual(['gimel', 'mac']);
  await screen.unmount();
  expect(useHostFeeds.getState().feeds).toEqual({});
});

// The selected host answered; another did not. The list keeps every row, says
// nothing about it as the list's error, and gives that host one line naming it.
it('leaves the selected host\'s error alone when another host fails, and sets its notice', async () => {
  mockPolls.set('gimel', { summaries: [chat('w1', 'herdrchat')] });
  mockPolls.set('mac', { summaries: [chat('w1', 'kenneth-bot')], error: 'Timed out.', errorCode: 'connect_failed' });
  const screen = await render(<Probe />);
  expect(seen.current!.error).toBeNull();
  expect(seen.current!.summaries.map((row) => row.connectionId)).toEqual(['gimel', 'mac']);
  expect(seen.current!.notices).toEqual([{ hostId: 'mac', label: 'MacBook', text: 'MacBook: Timed out.' }]);
  await screen.unmount();
});

// One host down is not every host down: the others' rows still show.
it('keeps another host\'s rows while the selected one is failing', async () => {
  mockPolls.set('gimel', { error: 'Host down', errorCode: 'connect_failed' });
  mockPolls.set('mac', { summaries: [chat('w1', 'kenneth-bot')] });
  const screen = await render(<Probe />);
  expect(seen.current!.error).toBe('Host down');
  expect(seen.current!.summaries.map((row) => row.connectionId)).toEqual(['mac']);
  await screen.unmount();
});

it('drops a host\'s rows once it is removed', async () => {
  mockPolls.set('gimel', { summaries: [chat('w1', 'herdrchat')] });
  mockPolls.set('mac', { summaries: [chat('w1', 'kenneth-bot')] });
  const screen = await render(<Probe />);
  expect(seen.current!.summaries).toHaveLength(2);
  await act(async () => {
    useConnections.setState({ connections: [host] });
  });
  expect(seen.current!.summaries.map((row) => row.connectionId)).toEqual(['gimel']);
  expect(seen.current!.connectionIds).toEqual(['gimel']);
  expect(useHostFeeds.getState().feeds).toEqual({});
  await screen.unmount();
});

// App Review and the e2e flows see the Demo alone.
it('lists the Demo by itself', async () => {
  mockPolls.set('demo', { summaries: [chat('w1', 'herdrchat')] });
  mockPolls.set('mac', { summaries: [chat('w1', 'kenneth-bot')] });
  const screen = await render(<Probe selected={demo} />);
  expect(seen.current!.summaries.map((row) => row.connectionId)).toEqual(['demo']);
  await screen.unmount();
});
