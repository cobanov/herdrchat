import { act, renderHook } from '@testing-library/react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { HerdrClient } from '@/lib/herdr/client';
import type { AgentInfo, Snapshot } from '@/lib/herdr/models';
import { seedMessages, rebind } from '@/state/threadCache';
import { useThread } from '../useThread';

let mockPolling = true;
let mockLive = true;
jest.mock('../../usePollGate', () => ({ usePollGate: () => mockPolling }));
jest.mock('../../useHostEvents', () => ({ useHostEvents: () => mockLive }));
jest.mock('../useReportPresence', () => ({
  useReportPresence: () => undefined,
}));
jest.mock('@/state/settings', () => ({ useSettings: () => 1 }));
jest.mock('@/state/threadCache', () => ({
  appendMessages: jest.fn(async () => undefined),
  rebind: jest.fn(async () => false),
  resetTailCursor: jest.fn(async () => undefined),
  seedMessages: jest.fn(async () => []),
  seenIds: jest.fn(async () => new Set<string>()),
  setTailCursor: jest.fn(async () => undefined),
  tailCursor: jest.fn(async () => null),
}));
jest.mock('@/lib/transcript/store', () => ({
  TranscriptStore: class {
    homeDirectory = async () => '/test';
    sessionTranscriptPath = (_home: string, _cwd: string, id: string) => `/test/${id}.jsonl`;
    fileProbe = async () => ({ kind: 'exists', bytes: 0 });
    recent = async () => ({ messages: [], consumedBytes: 0, startByte: 0 });
    sessionMeta = async () => null;
    *tail() {
      yield* [];
    }
  },
}));

const agent: AgentInfo = {
  agent: 'claude',
  agentStatus: 'idle',
  cwd: '/test',
  foregroundCwd: null,
  focused: true,
  paneId: 'pane',
  tabId: 'tab',
  terminalId: null,
  workspaceId: 'chat',
  agentSession: { kind: 'id', value: 'session', agent: 'claude', source: null },
};
const snapshot = (agents: AgentInfo[]): Snapshot => ({
  agents,
  workspaces: [],
  version: '0.9.0',
  protocol: null,
  layouts: null,
  focusedPaneId: null,
  focusedTabId: null,
  focusedWorkspaceId: null,
});
const db = {
  runAsync: jest.fn(async () => undefined),
} as unknown as SQLiteDatabase;
const client = new HerdrClient({
  exec: async () => ({ ok: true, exitCode: 0, stdout: '', stderr: '' }),
  streamLines: async function* () {
    yield* [];
  },
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockPolling = true;
  mockLive = true;
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('waits for the live session before reading a workspace cache', async () => {
  let answer: ((value: Snapshot) => void) | undefined;
  jest.spyOn(client, 'snapshot').mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      })
  );
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  expect(result.current.loading).toBe(true);
  expect(seedMessages).not.toHaveBeenCalled();
  await act(async () => {
    answer?.(snapshot([agent]));
  });
  expect(rebind).toHaveBeenCalledWith(db, 'host', 'chat', 'session');
  expect(seedMessages).toHaveBeenCalledTimes(1);
  expect(result.current.loading).toBe(false);
  await unmount();
});

it('does not offer sending into an empty shell', async () => {
  jest
    .spyOn(client, 'snapshot')
    .mockResolvedValue(snapshot([{ ...agent, agent: null, agentSession: null }]));
  const send = jest.spyOn(client, 'sendPrompt');
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  expect(result.current.canSend).toBe(false);
  await act(async () => {
    await result.current.send('Do not type this into a shell');
  });
  expect(send).not.toHaveBeenCalled();
  expect(result.current.messages).toEqual([]);
  await unmount();
});

it('reloads immediately even while the idle event stream is live', async () => {
  const fetch = jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([agent]));
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  fetch.mockClear();
  await act(async () => {
    await result.current.reload();
  });
  await act(async () => {
    jest.advanceTimersByTime(250);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(db.runAsync).toHaveBeenCalledWith(
    expect.stringContaining('DELETE FROM tail_cursors'),
    'host',
    'chat'
  );
  await unmount();
});

it('does not restart the poll when the event feed becomes live', async () => {
  mockLive = false;
  const fetch = jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([agent]));
  const { rerender, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  mockLive = true;
  await rerender(undefined);
  expect(fetch).toHaveBeenCalledTimes(1);
  await unmount();
});

it('does not resurrect a backgrounded poll after its request finishes', async () => {
  let answer: ((value: Snapshot) => void) | undefined;
  const fetch = jest.spyOn(client, 'snapshot').mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      })
  );
  const { rerender, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  mockPolling = false;
  await rerender(undefined);
  await act(async () => {
    answer?.(snapshot([agent]));
  });
  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  await unmount();
});
