import { act, renderHook } from '@testing-library/react-native';

import { HerdrClient } from '@/lib/herdr/client';
import { decodeSnapshot } from '@/lib/herdr/models';
import { useWorkspaces } from '../useWorkspaces';
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
