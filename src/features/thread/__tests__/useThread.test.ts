import { act, renderHook } from '@testing-library/react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { HerdrClient } from '@/lib/herdr/client';
import type { AgentInfo, Snapshot } from '@/lib/herdr/models';
import type { FileProbe } from '@/lib/transcript/store';
import type { ChatMessage } from '@/lib/transcript/message';
import { HerdrError } from '@/lib/herdr/protocol';
import { seedMessages, rebind } from '@/state/threadCache';
import { useThread } from '../useThread';

let mockPolling = true;
let mockLive = true;
let mockProbe: FileProbe = { kind: 'size', bytes: 0 };
const mockCodexPath = jest.fn<Promise<string | null>, [string]>(async () => '/test/codex.jsonl');
let mockRecentMessages: ChatMessage[] = [];
let mockLiveReceipt = false;
let mockEmitReceipt: ((message: ChatMessage) => void) | null = null;
async function* mockTail() {
  if (mockLiveReceipt) {
    const message = await new Promise<ChatMessage>(resolve => { mockEmitReceipt = resolve; });
    yield { message, meta: null, consumedBytes: 100 };
  }
}
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
    codexTranscriptPath = mockCodexPath;
    forgetCodexTranscript = jest.fn();
    fileProbe = async () => mockProbe;
    recent = async () => ({ messages: mockRecentMessages, consumedBytes: 0, startByte: 0 });
    sessionMeta = async () => null;
    tail = mockTail;
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
  mockProbe = { kind: 'size', bytes: 0 };
  mockCodexPath.mockResolvedValue('/test/codex.jsonl');
  mockRecentMessages = [];
  mockLiveReceipt = false;
  mockEmitReceipt = null;
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

it('finishes loading when a new session has not created its transcript yet', async () => {
  mockProbe = { kind: 'absent' };
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([agent]));
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  expect(result.current.loading).toBe(false);
  expect(result.current.canSend).toBe(true);
  expect(result.current.messages).toEqual([]);
  expect(result.current.error).toBeNull();
  await unmount();
});

it('resolves a Codex transcript by native session id and namespaces its cache', async () => {
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([{ ...agent, agent: 'codex' }]));
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  expect(mockCodexPath).toHaveBeenCalledWith('session');
  expect(rebind).toHaveBeenCalledWith(db, 'host', 'chat', 'codex:session');
  expect(result.current.loading).toBe(false);
  expect(result.current.sessionState).toBe('ok');
  await unmount();
});

it('explains a Codex file lookup failure instead of leaving the spinner running', async () => {
  mockCodexPath.mockResolvedValue(null);
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([{ ...agent, agent: 'codex' }]));
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toContain('Codex session is identified');
  await unmount();
});

it('does not treat an unsupported agent as a Claude transcript', async () => {
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([{ ...agent, agent: 'gemini' }]));
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  expect(result.current.sessionState).toBe('unsupported');
  expect(result.current.canSend).toBe(false);
  expect(result.current.loading).toBe(false);
  expect(seedMessages).not.toHaveBeenCalled();
  await unmount();
});

it('keeps a repeated prompt visible until a NEW host message acknowledges it', async () => {
  mockRecentMessages = [{ id: 'old-prompt', role: 'user', segments: [{ kind: 'text', text: 'again' }],
    timestamp: 1, agentLabel: null, isSidechain: false }];
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([agent]));
  jest.spyOn(client, 'sendPrompt').mockResolvedValue('delivered');
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  await act(async () => { await result.current.send('again'); });
  expect(result.current.messages).toHaveLength(2);
  expect(result.current.messages[1]?.id).toMatch(/^local-/);
  await unmount();
});

it('accepts a Codex transcript receipt even when terminal delivery cannot be observed', async () => {
  mockLiveReceipt = true;
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([{ ...agent, agent: 'codex' }]));
  let rejectSend: ((error: Error) => void) | undefined;
  jest.spyOn(client, 'sendPrompt').mockImplementation(() => new Promise((_resolve, reject) => { rejectSend = reject; }));
  const keys = jest.spyOn(client, 'sendKeys');
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  let sent: Promise<void> | undefined;
  await act(async () => { sent = result.current.send('Phone prompt'); });
  await act(async () => { mockEmitReceipt?.({ id: 'host-prompt', role: 'user', segments: [{ kind: 'text', text: 'Phone prompt' }],
    timestamp: Date.now(), agentLabel: null, isSidechain: false }); });
  await act(async () => { rejectSend?.(new HerdrError('agent_prompt_unverifiable', 'No composer observation')); await sent; });
  expect(result.current.messages.map(message => message.id)).toEqual(['host-prompt']);
  expect(result.current.error).toBeNull();
  expect(result.current.failedIds.size).toBe(0);
  expect(keys).not.toHaveBeenCalled();
  await unmount();
});

it('never presses Enter again when a Codex send remains unverified', async () => {
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([{ ...agent, agent: 'codex' }]));
  jest.spyOn(client, 'sendPrompt').mockResolvedValue('unverified');
  const wait = jest.spyOn(client, 'waitAgentStatus').mockResolvedValue(false);
  const keys = jest.spyOn(client, 'sendKeys').mockResolvedValue(undefined);
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  let sent: Promise<void> | undefined;
  await act(async () => { sent = result.current.send('Not acknowledged yet'); });
  await act(async () => { await jest.advanceTimersByTimeAsync(5_100); await sent; });
  expect(keys).not.toHaveBeenCalled();
  expect(wait).not.toHaveBeenCalled();
  expect(result.current.error).toContain('Check the host before retrying');
  await unmount();
});

it('ends the initial spinner when the transcript probe reports a read failure', async () => {
  mockProbe = { kind: 'unknown', reason: 'Permission denied' };
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([agent]));
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toContain('Permission denied');
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
