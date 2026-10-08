import { act, renderHook } from '@testing-library/react-native';

import { HerdrClient } from '@/lib/herdr/client';
import { decodeSnapshot } from '@/lib/herdr/models';
import { HerdrError } from '@/lib/herdr/protocol';
import { buildSummaries, refreshPreviews, useWorkspaces, type CachedPreview } from '../useWorkspaces';
import { TranscriptStore, type PreviewRequest } from '@/lib/transcript/store';
import type { ChatMessage } from '@/lib/transcript/message';

let mockPolling = true;
let mockLive = true;
let mockEvent: () => void = () => undefined;
let mockPreview = 'Before';
jest.mock('../../usePollGate', () => ({ usePollGate: () => mockPolling }));
jest.mock('../../useHostEvents', () => ({
  useHostEvents: (_client: unknown, _panes: unknown, _enabled: unknown, event: () => void) => {
    mockEvent = event;
    return mockLive;
  },
}));
jest.mock('@/state/settings', () => ({ useSettings: () => 1 }));
jest.mock('@/lib/transcript/store', () => ({
  previewText: (message: ChatMessage) =>
    message.segments[0]?.kind === 'text' ? message.segments[0].text : null,
  TranscriptStore: class {
    latestMessages = async (requests: readonly { workspaceId: string; key?: string }[]) =>
      new Map(requests.map((request) => [
        request.key ?? request.workspaceId,
        {
          role: 'assistant',
          timestamp: 100,
          segments: [{ kind: 'text', text: mockPreview }],
        },
      ]));
  },
}));
const client = new HerdrClient({
  exec: async () => ({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
  streamLines: async function* () {
    yield* [];
  },
});
const snapshot = decodeSnapshot({
  version: '0.9.0',
  workspaces: [{ workspace_id: 'chat', label: 'Test', number: 1, agent_status: 'idle' }],
  agents: [
    {
      workspace_id: 'chat',
      pane_id: 'pane',
      agent: 'claude',
      agent_status: 'idle',
      cwd: '/test',
      agent_session: { kind: 'id', value: 'session' },
    },
  ],
});
beforeEach(() => {
  jest.useFakeTimers();
  mockPolling = true;
  mockLive = true;
  mockPreview = 'Before';
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// #88: a kick that lands while a poll is in flight must not be lost when
// that poll finishes and schedules its own next round.
it('honours an event that arrives while a poll is in flight', async () => {
  const fetch = jest.spyOn(client, 'snapshot').mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(snapshot), 100))
  );
  const { unmount } = await renderHook(() => useWorkspaces(client));
  await act(async () => { await jest.advanceTimersByTimeAsync(100); }); // first poll done
  await act(async () => { mockEvent(); await jest.advanceTimersByTimeAsync(300); }); // poll #2 in flight
  await act(async () => { mockEvent(); await jest.advanceTimersByTimeAsync(1_700); }); // event mid-poll
  expect(fetch).toHaveBeenCalledTimes(3);
  await unmount();
});

// #86: a chat's identity is its session, not its workspace slot.
it('never shows the previous chat\'s preview in a reused workspace slot', async () => {
  const withSession = snapshot;
  const closed = decodeSnapshot({ version: '0.9.0', workspaces: [], agents: [] });
  const recycledNoSession = decodeSnapshot({
    version: '0.9.0',
    workspaces: [{ workspace_id: 'chat', label: 'New chat', number: 1, agent_status: 'working' }],
    agents: [{ workspace_id: 'chat', pane_id: 'p9', agent: 'claude', agent_status: 'working', cwd: '/b' }],
  });
  const fetch = jest.spyOn(client, 'snapshot').mockResolvedValue(withSession);
  mockLive = false;
  const { result, unmount } = await renderHook(() => useWorkspaces(client));
  expect(result.current.summaries[0]?.preview?.text).toBe('Before');

  fetch.mockResolvedValue(closed);
  await act(async () => { await jest.advanceTimersByTimeAsync(3_100); });
  fetch.mockResolvedValue(recycledNoSession);
  await act(async () => { await jest.advanceTimersByTimeAsync(3_100); });
  expect(result.current.summaries[0]?.title).toBe('New chat');
  expect(result.current.summaries[0]?.preview).toBeNull();
  await unmount();
});

it('drops the preview the moment the slot reports a different session', async () => {
  const fetch = jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot);
  mockLive = false;
  const { result, unmount } = await renderHook(() => useWorkspaces(client));
  expect(result.current.summaries[0]?.preview?.text).toBe('Before');
  const other = decodeSnapshot({
    version: '0.9.0',
    workspaces: [{ workspace_id: 'chat', label: 'Test', number: 1, agent_status: 'idle' }],
    agents: [{ workspace_id: 'chat', pane_id: 'pane', agent: 'claude', agent_status: 'idle', cwd: '/test',
      agent_session: { kind: 'id', value: 'another-session' } }],
  });
  fetch.mockResolvedValue(other);
  mockPreview = 'New chat line';
  await act(async () => { await jest.advanceTimersByTimeAsync(3_100); });
  expect(result.current.summaries[0]?.preview?.text).toBe('New chat line');
  await unmount();
});

// #96: the list needs the failure's code to offer the matching way out.
it('carries herdr\'s restore error onto the chat it belongs to (#119)', async () => {
  jest.spyOn(client, 'snapshot').mockResolvedValue(decodeSnapshot({
    version: '0.9.2',
    workspaces: [
      { workspace_id: 'chat', label: 'Test', number: 1, agent_status: 'idle' },
      { workspace_id: 'gone', label: 'Gone', number: 2, agent_status: 'unknown' },
    ],
    panes: [{ pane_id: 'p9', workspace_id: 'gone', restore_error: 'Saved directory is unavailable.' }],
    agents: [],
  }));
  const { result, unmount } = await renderHook(() => useWorkspaces(client));
  expect(result.current.summaries.map((chat) => chat.restoreError)).toEqual([null, 'Saved directory is unavailable.']);
  await unmount();
});

// herdr calls an agent at Claude's folder-trust question idle; the row has to
// say the chat needs you, or nobody opens it to answer.
it('marks a chat whose agent waits on a menu as needing you', async () => {
  jest.spyOn(client, 'snapshot').mockResolvedValue(decodeSnapshot({
    version: '0.9.0',
    workspaces: [
      { workspace_id: 'chat', label: 'New', number: 1, agent_status: 'idle' },
      { workspace_id: 'busy', label: 'Busy', number: 2, agent_status: 'working' },
    ],
    agents: [
      { workspace_id: 'chat', pane_id: 'p1', agent: 'claude', agent_status: 'idle', cwd: '/new', input_pending: true },
      { workspace_id: 'busy', pane_id: 'p2', agent: 'claude', agent_status: 'working', cwd: '/b', input_pending: true },
    ],
  }));
  const { result, unmount } = await renderHook(() => useWorkspaces(client));
  expect(result.current.summaries.map((chat) => chat.status)).toEqual(['blocked', 'working']);
  await unmount();
});

// The chat list shows its changed-key banner from this code; it used to match
// the native message, and silently stopped when that wording changed.
it('reports a changed host key by its code, whatever the message says', async () => {
  jest.spyOn(client, 'snapshot').mockRejectedValue(
    new HerdrError('host_key_changed', "This host's SSH key has changed since you saved it.", { transport: true })
  );
  const { result, unmount } = await renderHook(() => useWorkspaces(client));
  expect(result.current.errorCode).toBe('host_key_changed');
  await unmount();
});

it('reports why the host could not be listed', async () => {
  jest.spyOn(client, 'snapshot').mockRejectedValue(new HerdrError('auth_failed', 'The server rejected these credentials.'));
  const { result, unmount } = await renderHook(() => useWorkspaces(client));
  expect(result.current.error).toContain('rejected');
  expect(result.current.errorCode).toBe('auth_failed');
  expect(result.current.summaries).toEqual([]);
  await unmount();
});

it('refreshes an idle chat preview on the event that finished its turn', async () => {
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot);
  const { result, unmount } = await renderHook(() => useWorkspaces(client));
  expect(result.current.summaries[0]?.preview?.text).toBe('Before');
  mockPreview = 'After';
  await act(async () => {
    mockEvent();
    jest.advanceTimersByTime(250);
  });
  expect(result.current.summaries[0]?.preview?.text).toBe('After');
  await unmount();
});

it('keeps one poll when the stream connects', async () => {
  mockLive = false;
  const fetch = jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot);
  const { rerender, unmount } = await renderHook(() => useWorkspaces(client));
  mockLive = true;
  await rerender(undefined);
  expect(fetch).toHaveBeenCalledTimes(1);
  await unmount();
});

it('does not rearm a covered list after an in-flight refresh completes', async () => {
  let answer: ((value: typeof snapshot) => void) | undefined;
  const fetch = jest.spyOn(client, 'snapshot').mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      })
  );
  const { rerender, unmount } = await renderHook(() => useWorkspaces(client));
  mockPolling = false;
  await rerender(undefined);
  await act(async () => {
    answer?.(snapshot);
  });
  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  await unmount();
});

// A turn that starts and ends between two polls looks idle both times; only
// herdr's state counter shows it happened (#115).
it('refreshes an idle chat whose state counter moved between polls', async () => {
  const store = new TranscriptStore({} as never);
  const fetch = jest.spyOn(store, 'latestMessages');
  const previews = new Map<string, CachedPreview>();
  const seqs = new Map<string, number>();
  const tick = { current: 0 };
  const at = (seq: number) => decodeSnapshot({
    agents: [{
      workspace_id: 'chat', pane_id: 'pane', agent: 'claude', agent_status: 'idle', cwd: '/test',
      agent_session: { kind: 'id', value: 'session' }, state_change_seq: seq,
    }],
  }).agents;

  await refreshPreviews(store, at(4), previews, tick, false, seqs);
  expect(fetch).toHaveBeenCalledTimes(1);
  await refreshPreviews(store, at(4), previews, tick, false, seqs);
  expect(fetch).toHaveBeenCalledTimes(1);
  await refreshPreviews(store, at(6), previews, tick, false, seqs);
  expect(fetch).toHaveBeenCalledTimes(2);
});

// Retrying rejected credentials only adds failed logins, which OpenSSH
// penalises per source address (#4 acceptance: sshd refused the phone).
it('stops polling on a failure only the user can fix, until a pull to refresh', async () => {
  mockLive = false;
  const snapshot = jest.spyOn(client, 'snapshot').mockRejectedValue(new HerdrError('auth_failed', 'rejected'));
  const { result, unmount } = await renderHook(() => useWorkspaces(client));
  await act(async () => { await jest.advanceTimersByTimeAsync(300_000); });
  expect(snapshot).toHaveBeenCalledTimes(1);
  await act(async () => { await result.current.refresh(); });
  expect(snapshot).toHaveBeenCalledTimes(2);
  await unmount();
});

it('keeps retrying, with backoff, a host that is merely unreachable', async () => {
  mockLive = false;
  const snapshot = jest.spyOn(client, 'snapshot').mockRejectedValue(new HerdrError('connect_failed', 'down'));
  const { unmount } = await renderHook(() => useWorkspaces(client));
  await act(async () => { await jest.advanceTimersByTimeAsync(300_000); });
  expect(snapshot.mock.calls.length).toBeGreaterThan(3);
  await unmount();
});

// MARK: - Several agents in one workspace

const twoAgents = (p2: Record<string, unknown> = {}) => decodeSnapshot({
  version: '0.9.0',
  workspaces: [{ workspace_id: 'w6', label: 'api', number: 6, agent_status: 'idle' }],
  agents: [
    { workspace_id: 'w6', pane_id: 'w6:p1', agent: 'claude', agent_status: 'idle', cwd: '/api', focused: true,
      agent_session: { kind: 'id', value: 'sess-1' }, state_change_seq: 1 },
    { workspace_id: 'w6', pane_id: 'w6:p2', agent: 'claude', agent_status: 'idle', cwd: '/api/web',
      agent_session: { kind: 'id', value: 'sess-2' }, state_change_seq: 1, ...p2 },
    { workspace_id: 'w6', pane_id: 'w6:p3', agent: null, agent_status: 'unknown', cwd: '/api' },
  ],
});
const message = (text: string, timestamp: number) =>
  ({ role: 'assistant', timestamp, segments: [{ kind: 'text', text }] }) as unknown as ChatMessage;
/** A store that answers each request with a line naming the session it read. */
const storeAnswering = (at: Record<string, number> = {}) => {
  const latestMessages = jest.fn(async (requests: readonly PreviewRequest[]) =>
    new Map(requests.map((request) => [request.key ?? request.workspaceId,
      message(`from ${request.sessionId ?? ''}`, at[request.sessionId ?? ''] ?? 100)])));
  return { store: { latestMessages } as unknown as TranscriptStore, latestMessages };
};

// Fetched per workspace, only the elected agent ever had a line; the other
// agent's row could show nothing and its dot could never light.
it('fetches one preview per agent in a single batch, and files each by its pane', async () => {
  const { store, latestMessages } = storeAnswering();
  const previews = new Map<string, CachedPreview>();
  await refreshPreviews(store, twoAgents().agents, previews, { current: 0 });

  expect(latestMessages).toHaveBeenCalledTimes(1);
  expect(latestMessages.mock.calls[0]?.[0].map((request) => [request.key, request.sessionId])).toEqual([
    ['w6:p1', 'sess-1'], ['w6:p2', 'sess-2'],
  ]);
  expect(previews.get('w6:p1')).toMatchObject({ sessionSig: 'sess-1', preview: { text: 'from sess-1' } });
  expect(previews.get('w6:p2')).toMatchObject({ sessionSig: 'sess-2', preview: { text: 'from sess-2' } });
});

it('between sweeps refreshes only the agent that is busy or moved', async () => {
  const { store, latestMessages } = storeAnswering();
  const previews = new Map<string, CachedPreview>();
  const seqs = new Map<string, number>();
  const tick = { current: 0 };
  await refreshPreviews(store, twoAgents().agents, previews, tick, false, seqs);
  await refreshPreviews(store, twoAgents().agents, previews, tick, false, seqs);
  expect(latestMessages).toHaveBeenCalledTimes(1);
  await refreshPreviews(store, twoAgents({ agent_status: 'working' }).agents, previews, tick, false, seqs);
  expect(latestMessages.mock.calls[1]?.[0].map((request) => request.key)).toEqual(['w6:p2']);
  await refreshPreviews(store, twoAgents({ state_change_seq: 2 }).agents, previews, tick, false, seqs);
  expect(latestMessages.mock.calls[2]?.[0].map((request) => request.key)).toEqual(['w6:p2']);
});

it('summarises each agent with its own line, and the workspace with the newest', async () => {
  const { store } = storeAnswering({ 'sess-1': 100, 'sess-2': 200 });
  const previews = new Map<string, CachedPreview>();
  const { agents, workspaces } = twoAgents({ agent_status: 'working' });
  await refreshPreviews(store, agents, previews, { current: 0 });
  const [summary] = buildSummaries(workspaces ?? [], agents, previews);

  expect(summary?.panes.map((pane) => [pane.paneId, pane.sessionSig, pane.preview?.text, pane.status])).toEqual([
    ['w6:p1', 'sess-1', 'from sess-1', 'idle'],
    ['w6:p2', 'sess-2', 'from sess-2', 'working'],
  ]);
  // The plain shell has no chat of its own, but stays among the agents.
  expect(summary?.agents).toHaveLength(3);
  expect(summary?.preview?.text).toBe('from sess-2');
  expect(summary?.sessionSig).toBe('sess-1,sess-2');
  // herdr said idle for the workspace; one of its agents is working.
  expect(summary?.status).toBe('working');
});

it('says a workspace needs you when any one of its agents waits on a menu', () => {
  const { agents, workspaces } = twoAgents({ agent_status: 'working' });
  const waiting = agents.map((agent) => agent.paneId === 'w6:p1' ? { ...agent, inputPending: true } : agent);
  const [summary] = buildSummaries(workspaces ?? [], waiting, new Map());
  expect(summary?.panes.map((pane) => pane.status)).toEqual(['blocked', 'working']);
  expect(summary?.status).toBe('blocked');
});

// herdr recycles pane ids: a new conversation in the same pane must not wear
// the previous one's line.
it('hides a pane\'s line once a different session holds the pane', async () => {
  const { store } = storeAnswering();
  const previews = new Map<string, CachedPreview>();
  await refreshPreviews(store, twoAgents().agents, previews, { current: 0 });
  const { agents, workspaces } = twoAgents({ agent_session: { kind: 'id', value: 'sess-new' } });
  const [summary] = buildSummaries(workspaces ?? [], agents, previews);
  expect(summary?.panes.map((pane) => [pane.sessionSig, pane.preview?.text ?? null])).toEqual([
    ['sess-1', 'from sess-1'], ['sess-new', null],
  ]);
});

it('keeps a single-agent workspace exactly as it was: one row, its own line, no pane rows', async () => {
  const { store } = storeAnswering();
  const previews = new Map<string, CachedPreview>();
  await refreshPreviews(store, snapshot.agents, previews, { current: 0 });
  const [summary] = buildSummaries(snapshot.workspaces ?? [], snapshot.agents, previews);
  expect(summary).toMatchObject({ status: 'idle', sessionSig: 'session', preview: { text: 'from session' } });
  expect(summary?.panes).toHaveLength(1);
});
