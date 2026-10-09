import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { HerdrClient } from '@/lib/herdr/client';
import { decodeSnapshot } from '@/lib/herdr/models';
import { HerdrError } from '@/lib/herdr/protocol';
import { refreshPreviews, useWorkspaces, type CachedPreview } from '../useWorkspaces';
import { TranscriptStore } from '@/lib/transcript/store';
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
let mockHostThemes = true;
jest.mock('@/state/settings', () => ({
  useSettings: (select: (state: { pollScale: number; useHostThemes: boolean }) => unknown) =>
    select({ pollScale: 1, useHostThemes: mockHostThemes }),
}));
const mockCheckTheme = jest.fn(async (_connectionId: string, _transport: unknown) => true);
jest.mock('@/state/hostTheme', () => ({
  checkHostTheme: (connectionId: string, transport: unknown) => mockCheckTheme(connectionId, transport),
}));
jest.mock('@/lib/transcript/store', () => ({
  previewText: (message: ChatMessage) =>
    message.segments[0]?.kind === 'text' ? message.segments[0].text : null,
  TranscriptStore: class {
    latestMessages = async () =>
      new Map([
        [
          'chat',
          {
            role: 'assistant',
            timestamp: 100,
            segments: [{ kind: 'text', text: mockPreview }],
          },
        ],
      ]);
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
  mockHostThemes = true;
  mockCheckTheme.mockReset();
  mockCheckTheme.mockResolvedValue(true);
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

describe('the host theme check, riding on the list poll', () => {
  beforeEach(() => {
    mockLive = false; // a poll every 3 s
    jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot);
  });

  it('checks on the first poll, then at most every 10 s', async () => {
    const { unmount } = await renderHook(() => useWorkspaces(client, 'host'));
    expect(mockCheckTheme).toHaveBeenCalledTimes(1);
    expect(mockCheckTheme).toHaveBeenLastCalledWith('host', client.transport);
    // Polls at 3, 6 and 9 s: none of them is due.
    await act(async () => { await jest.advanceTimersByTimeAsync(9_100); });
    expect(mockCheckTheme).toHaveBeenCalledTimes(1);
    // The poll at 12 s is.
    await act(async () => { await jest.advanceTimersByTimeAsync(3_000); });
    expect(mockCheckTheme).toHaveBeenCalledTimes(2);
    await unmount();
  });

  it('checks again on a pull to refresh and on coming back to the foreground', async () => {
    let onChange: (state: AppStateStatus) => void = () => undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      onChange = listener as (state: AppStateStatus) => void;
      return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
    });
    const { result, unmount } = await renderHook(() => useWorkspaces(client, 'host'));
    await act(async () => { await result.current.refresh(); });
    expect(mockCheckTheme).toHaveBeenCalledTimes(2);
    await act(async () => { onChange('active'); });
    await act(async () => { await jest.advanceTimersByTimeAsync(3_100); });
    expect(mockCheckTheme).toHaveBeenCalledTimes(3);
    await unmount();
  });

  it('never checks after a poll that failed', async () => {
    jest.spyOn(client, 'snapshot').mockRejectedValue(new HerdrError('connect_failed', 'down'));
    const { unmount } = await renderHook(() => useWorkspaces(client, 'host'));
    expect(mockCheckTheme).not.toHaveBeenCalled();
    await unmount();
  });

  it('never checks without a host to file it under, or with host themes off', async () => {
    const anonymous = await renderHook(() => useWorkspaces(client));
    await anonymous.unmount();
    mockHostThemes = false;
    const off = await renderHook(() => useWorkspaces(client, 'host'));
    await off.unmount();
    expect(mockCheckTheme).not.toHaveBeenCalled();
  });

  // The check is a side task: the list never waits on it or reports it.
  it('keeps a failed or hanging check out of the list', async () => {
    mockCheckTheme.mockImplementation(() => new Promise(() => undefined));
    const { result, unmount } = await renderHook(() => useWorkspaces(client, 'host'));
    expect(result.current.summaries).toHaveLength(1);
    expect(result.current.error).toBeNull();
    mockCheckTheme.mockResolvedValue(false);
    await act(async () => { await jest.advanceTimersByTimeAsync(12_100); });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    await unmount();
  });
});
