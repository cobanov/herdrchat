import { act, renderHook } from '@testing-library/react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { HerdrClient } from '@/lib/herdr/client';
import type { AgentInfo, Snapshot } from '@/lib/herdr/models';
import type { FileProbe } from '@/lib/transcript/store';
import type { ChatMessage } from '@/lib/transcript/message';
import type { SessionMeta } from '@/lib/transcript/sessionMeta';
import { HerdrError } from '@/lib/herdr/protocol';
import { seedMessages, rebind, replaceMessages, tailCursor, setTailCursor } from '@/state/threadCache';
import { useThread } from '../useThread';

let mockPolling = true;
let mockLive = true;
let mockProbe: FileProbe = { kind: 'size', bytes: 0 };
const mockCodexPath = jest.fn<Promise<string | null>, [string]>(async () => '/test/codex.jsonl');
let mockRecentMessages: ChatMessage[] = [];
const mockRecent = jest.fn(async (_path: string, _label: string | null, _bytes: number, _limit: number) => ({
  messages: mockRecentMessages, consumedBytes: mockProbe.kind === 'size' ? mockProbe.bytes : 0, startByte: 0,
}));
const mockOlder = jest.fn(async (_path: string, _label: string | null, _anchor: number, _bytes: number) => ({
  messages: [] as ChatMessage[], startByte: 0, reachedStart: true,
}));
const mockTailStarts: { path: string; from: number }[] = [];
const mockTailSignals: (AbortSignal | undefined)[] = [];
const mockSessionMeta = jest.fn<Promise<SessionMeta | null>, [string, string | null]>();
let mockLiveMeta: SessionMeta[] = [];
let mockLiveReceipt = false;
let mockEmitReceipt: ((message: ChatMessage) => void) | null = null;
async function* mockTail(path: string, _label: string | null, from: number, signal?: AbortSignal) {
  mockTailStarts.push({ path, from });
  mockTailSignals.push(signal);
  for (const meta of mockLiveMeta) yield { message: null, meta, consumedBytes: from };
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
  replaceMessages: jest.fn(async () => undefined),
  seedMessages: jest.fn(async () => []),
  setTailCursor: jest.fn(async () => undefined),
  tailCursor: jest.fn(async () => null),
}));
jest.mock('@/lib/transcript/store', () => ({
  TranscriptStore: class {
    homeDirectory = async () => '/test';
    sessionTranscriptPath = (_home: string, _cwd: string, id: string) => `/test/${id}.jsonl`;
    claudeTranscriptPath = async (_cwd: string, id: string) => `/test/${id}.jsonl`;
    findClaudeTranscript = async () => null;
    codexTranscriptPath = mockCodexPath;
    forgetCodexTranscript = jest.fn();
    fileProbe = async () => mockProbe;
    recent = mockRecent;
    older = mockOlder;
    sessionMeta = mockSessionMeta;
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
  withTransactionAsync: jest.fn(async (task: () => Promise<void>) => task()),
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
  mockRecent.mockReset().mockImplementation(async () => ({
    messages: mockRecentMessages, consumedBytes: mockProbe.kind === 'size' ? mockProbe.bytes : 0, startByte: 0,
  }));
  mockOlder.mockReset().mockResolvedValue({ messages: [], startByte: 0, reachedStart: true });
  jest.mocked(seedMessages).mockResolvedValue([]);
  jest.mocked(tailCursor).mockResolvedValue(null);
  mockTailStarts.length = 0;
  mockTailSignals.length = 0;
  mockSessionMeta.mockReset().mockResolvedValue(null);
  mockLiveMeta = [];
  mockLiveReceipt = false;
  mockEmitReceipt = null;
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('passes cancellation into a silent transcript reader when the thread leaves', async () => {
  mockLiveReceipt = true;
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([agent]));
  const { unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  expect(mockTailSignals[0]?.aborted).toBe(false);
  await unmount();
  expect(mockTailSignals[0]?.aborted).toBe(true);
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
  expect(mockSessionMeta).toHaveBeenCalledWith('/test/codex.jsonl', 'codex');
  expect(rebind).toHaveBeenCalledWith(db, 'host', 'chat', 'codex:session');
  expect(result.current.loading).toBe(false);
  expect(result.current.sessionState).toBe('ok');
  await unmount();
});

it.each([
  { live: { model: null, contextTokens: 200 }, model: 'gpt-old', effort: 'high' },
  { live: { model: 'gpt-new', effort: 'low', contextTokens: null }, model: 'gpt-new', effort: 'low' },
  { live: { model: 'gpt-new', effort: null, contextTokens: null }, model: 'gpt-new', effort: null },
])('merges a late metadata seed without losing live usage or mixing turn settings: $model/$effort', async ({ live, model, effort }) => {
  let resolveSeed!: (meta: SessionMeta) => void;
  mockSessionMeta.mockImplementation(() => new Promise(resolve => { resolveSeed = resolve; }));
  mockLiveMeta = [live];
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([{ ...agent, agent: 'codex' }]));
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  await act(async () => { resolveSeed({ model: 'gpt-old', effort: 'high', contextTokens: 100 }); });
  expect(result.current.sessionMeta).toEqual({ model, effort, contextTokens: live.contextTokens ?? 100 });
  await unmount();
});

it('preserves effort on usage events but clears it when the next model does not report it', async () => {
  mockLiveMeta = [
    { model: 'gpt-old', effort: 'high', contextTokens: null },
    { model: null, contextTokens: 200 },
  ];
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([{ ...agent, agent: 'codex' }]));
  const first = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  expect(first.result.current.sessionMeta).toEqual({ model: 'gpt-old', effort: 'high', contextTokens: 200 });
  await first.unmount();
  mockLiveMeta.push({ model: 'gpt-new', effort: null, contextTokens: null });
  const second = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  expect(second.result.current.sessionMeta).toEqual({ model: 'gpt-new', effort: null, contextTokens: 200 });
  await second.unmount();
});

it('keeps sibling agents metadata separate and follows the focused pane', async () => {
  const sibling = { ...agent, focused: false, paneId: 'sibling',
    agentSession: { ...agent.agentSession!, value: 'sibling-session' } };
  let focused = [agent, sibling];
  jest.spyOn(client, 'snapshot').mockImplementation(async () => snapshot(focused));
  mockSessionMeta.mockImplementation(async path => ({
    model: path.includes('sibling') ? 'sibling-model' : 'primary-model', contextTokens: 100,
  }));
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  expect(result.current.sessionMeta?.model).toBe('primary-model');
  focused = [{ ...agent, focused: false }, { ...sibling, focused: true }];
  await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
  expect(result.current.sessionMeta?.model).toBe('sibling-model');
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

it('never presses Enter into an agent that went blocked after an unverified send (#76)', async () => {
  // The agent read the prompt and opened a permission menu. Enter there picks
  // the highlighted option, usually "Yes".
  const fetch = jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([agent]));
  jest.spyOn(client, 'sendPrompt').mockImplementation(async () => {
    fetch.mockResolvedValue(snapshot([{ ...agent, agentStatus: 'blocked' }]));
    return 'unverified';
  });
  const wait = jest.spyOn(client, 'waitAgentStatus').mockResolvedValue(false);
  const keys = jest.spyOn(client, 'sendKeys').mockResolvedValue(undefined);
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  let sent: Promise<void> | undefined;
  await act(async () => { sent = result.current.send('Refactor the parser'); });
  await act(async () => { await jest.advanceTimersByTimeAsync(5_100); await sent; });
  expect(wait).toHaveBeenCalledWith(agent.paneId, ['working', 'blocked'], expect.any(Number));
  expect(keys).not.toHaveBeenCalled();
  expect(result.current.failedIds.size).toBe(0);
  await unmount();
});

it('presses Enter once when an unverified prompt is still sitting in an idle composer', async () => {
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([agent]));
  jest.spyOn(client, 'sendPrompt').mockResolvedValue('unverified');
  const wait = jest.spyOn(client, 'waitAgentStatus').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const keys = jest.spyOn(client, 'sendKeys').mockResolvedValue(undefined);
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  let sent: Promise<void> | undefined;
  await act(async () => { sent = result.current.send('Run the tests'); });
  await act(async () => { await jest.advanceTimersByTimeAsync(5_100); await sent; });
  expect(keys).toHaveBeenCalledTimes(1);
  expect(keys).toHaveBeenCalledWith(agent.paneId, ['Enter']);
  expect(wait).toHaveBeenCalledTimes(2);
  expect(result.current.failedIds.size).toBe(0);
  await unmount();
});

it('presses nothing when the pane state cannot be read after an unverified send', async () => {
  const fetch = jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([agent]));
  jest.spyOn(client, 'sendPrompt').mockImplementation(async () => {
    fetch.mockRejectedValue(new HerdrError('timeout', 'no answer'));
    return 'unverified';
  });
  jest.spyOn(client, 'waitAgentStatus').mockResolvedValue(false);
  const keys = jest.spyOn(client, 'sendKeys').mockResolvedValue(undefined);
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  let sent: Promise<void> | undefined;
  await act(async () => { sent = result.current.send('Anything'); });
  await act(async () => { await jest.advanceTimersByTimeAsync(5_100); await sent; });
  expect(keys).not.toHaveBeenCalled();
  expect(result.current.failedIds.size).toBe(1);
  expect(result.current.error).toContain("Couldn't confirm delivery");
  await unmount();
});

// #82: the poll's success path used to clear every banner, including the
// warnings that exist to stop a second send into a live agent.
it('keeps a stalled-send warning through the next successful poll', async () => {
  mockLive = false; // poll every 2 s
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([agent]));
  jest.spyOn(client, 'sendPrompt').mockResolvedValue('stalled');
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  await act(async () => { await result.current.send('hello'); });
  expect(result.current.error).toContain('never picked that up');
  await act(async () => { await jest.advanceTimersByTimeAsync(4_100); });
  expect(result.current.error).toContain('never picked that up');
  await unmount();
});

it('keeps the Codex delivery notice through a live-stream poll', async () => {
  mockLive = true; // poll every 30 s
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([{ ...agent, agent: 'codex' }]));
  jest.spyOn(client, 'sendPrompt').mockResolvedValue('unverified');
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  let sent: Promise<void> | undefined;
  await act(async () => { sent = result.current.send('x'); });
  await act(async () => { await jest.advanceTimersByTimeAsync(5_100); await sent; });
  expect(result.current.error).toContain('Check the host before retrying');
  await act(async () => { await jest.advanceTimersByTimeAsync(30_100); });
  expect(result.current.error).toContain('Check the host before retrying');
  await unmount();
});

it('takes a send warning down on dismiss and on the next send', async () => {
  mockLive = false;
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([agent]));
  const prompt = jest.spyOn(client, 'sendPrompt').mockResolvedValue('stalled');
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  await act(async () => { await result.current.send('first'); });
  expect(result.current.error).not.toBeNull();
  await act(async () => { result.current.clearError(); });
  expect(result.current.error).toBeNull();
  await act(async () => { await result.current.send('second'); });
  expect(result.current.error).not.toBeNull();
  prompt.mockResolvedValue('delivered');
  await act(async () => { await result.current.send('third'); });
  expect(result.current.error).toBeNull();
  await unmount();
});

it('says a message may have arrived when the connection drops mid-send (#83)', async () => {
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([agent]));
  jest.spyOn(client, 'sendPrompt').mockRejectedValue(
    new HerdrError('timeout', "The host didn't answer in time.", { transport: true })
  );
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  let sent: Promise<void> | undefined;
  await act(async () => { sent = result.current.send('deploy it'); });
  // Not failed at once: the transcript gets the chance to show it landed.
  expect(result.current.failedIds.size).toBe(0);
  await act(async () => { await jest.advanceTimersByTimeAsync(8_200); await sent; });
  expect(result.current.failedIds.size).toBe(1);
  expect(result.current.error).toContain('may have arrived');
  await unmount();
});

// #87: the host closed and recreated the workspace while the thread was open.
it('clears the old history and holds sending when a new agent takes the slot', async () => {
  mockLive = false;
  mockProbe = { kind: 'size', bytes: 10 };
  mockRecentMessages = [{ id: 'old-1', role: 'assistant', segments: [{ kind: 'text', text: 'old conversation' }],
    timestamp: 1, agentLabel: null, isSidechain: false }];
  const fetch = jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([agent]));
  const prompt = jest.spyOn(client, 'sendPrompt').mockResolvedValue('delivered');
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  await act(async () => { await jest.advanceTimersByTimeAsync(10); });
  expect(result.current.messages.map((message) => message.id)).toEqual(['old-1']);

  fetch.mockResolvedValue(snapshot([{ ...agent, paneId: 'new-pane', agentSession: null }]));
  await act(async () => { await jest.advanceTimersByTimeAsync(2_100); });
  expect(result.current.messages).toEqual([]);
  expect(result.current.sessionState).toBe('replaced');
  expect(result.current.canSend).toBe(false);
  await act(async () => { await result.current.send('reply meant for the old chat'); });
  expect(prompt).not.toHaveBeenCalled();
  await unmount();
});

it('clears the old history when the workspace loses its agents', async () => {
  mockLive = false;
  mockProbe = { kind: 'size', bytes: 10 };
  mockRecentMessages = [{ id: 'old-1', role: 'assistant', segments: [{ kind: 'text', text: 'old conversation' }],
    timestamp: 1, agentLabel: null, isSidechain: false }];
  const fetch = jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([agent]));
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  await act(async () => { await jest.advanceTimersByTimeAsync(10); });
  expect(result.current.messages).toHaveLength(1);
  fetch.mockResolvedValue(snapshot([]));
  await act(async () => { await jest.advanceTimersByTimeAsync(2_100); });
  expect(result.current.messages).toEqual([]);
  expect(result.current.canSend).toBe(false);
  await unmount();
});

it('keeps the thread bound when the same session moves to another pane', async () => {
  mockLive = false;
  mockProbe = { kind: 'size', bytes: 10 };
  mockRecentMessages = [{ id: 'old-1', role: 'assistant', segments: [{ kind: 'text', text: 'same chat' }],
    timestamp: 1, agentLabel: null, isSidechain: false }];
  const fetch = jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([agent]));
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  await act(async () => { await jest.advanceTimersByTimeAsync(10); });
  fetch.mockResolvedValue(snapshot([{ ...agent, paneId: 'resumed-pane' }]));
  await act(async () => { await jest.advanceTimersByTimeAsync(2_100); });
  expect(result.current.messages.map((message) => message.id)).toEqual(['old-1']);
  expect(result.current.sessionState).toBe('ok');
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
  expect(db.runAsync).toHaveBeenCalledWith(
    'DELETE FROM messages WHERE connection_id = ? AND workspace_id = ?',
    'host', 'chat'
  );
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

const turn = (id: string, timestamp = 1): ChatMessage => ({
  id, role: 'assistant', segments: [{ kind: 'text', text: id }],
  timestamp, agentLabel: null, isSidechain: false,
});

it.each(['claude', 'codex'])('opens a stale %s cache with one recent window, not a backlog replay', async kind => {
  mockProbe = { kind: 'size', bytes: 8_000_000 };
  jest.mocked(seedMessages).mockResolvedValue([turn('last-visit')]);
  jest.mocked(tailCursor).mockResolvedValue(10_000);
  const newest = Array.from({ length: 150 }, (_, index) => turn(`recent-${index}`, index + 100));
  let finish: ((value: Awaited<ReturnType<typeof mockRecent>>) => void) | undefined;
  mockRecent.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([{ ...agent, agent: kind }]));
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  expect(result.current.loading).toBe(true);
  expect(mockTailStarts).toEqual([]);
  expect(mockRecent).toHaveBeenCalledWith(expect.any(String), null, 384_000, 150);
  await act(async () => {
    finish?.({ messages: newest, consumedBytes: 8_000_000, startByte: 7_900_000 });
  });
  expect(result.current.loading).toBe(false);
  expect(result.current.messages).toEqual(newest);
  expect(result.current.historyVersion).toBe(1);
  expect(replaceMessages).toHaveBeenCalledTimes(1);
  expect(mockTailStarts).toEqual([{ path: expect.any(String), from: 8_000_000 }]);
  expect(result.current.reachedStart).toBe(false);
  // Previously cached records must still be eligible for scroll-up paging.
  mockOlder.mockResolvedValue({ messages: [turn('last-visit')], startByte: 0, reachedStart: true });
  await act(async () => { await result.current.loadOlder(); });
  expect(mockOlder).toHaveBeenCalledWith(expect.any(String), null, 7_900_000, 128_000);
  expect(result.current.messages[0]?.id).toBe('last-visit');
  await unmount();
});

it('uses the cache without a bulk read when the host file has not changed', async () => {
  mockProbe = { kind: 'size', bytes: 50_000 };
  jest.mocked(seedMessages).mockResolvedValue([turn('cached')]);
  jest.mocked(tailCursor).mockResolvedValue(50_000);
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([agent]));
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  expect(result.current.messages.map(message => message.id)).toEqual(['cached']);
  expect(mockRecent).not.toHaveBeenCalled();
  expect(replaceMessages).not.toHaveBeenCalled();
  expect(mockTailStarts).toEqual([{ path: '/test/session.jsonl', from: 50_000 - 4096 }]);
  await unmount();
});

it('keeps readable cache on a failed bulk read and never falls back to byte zero', async () => {
  mockProbe = { kind: 'size', bytes: 8_000_000 };
  jest.mocked(seedMessages).mockResolvedValue([turn('cached')]);
  jest.mocked(tailCursor).mockResolvedValue(10_000);
  mockRecent.mockRejectedValue(new Error('Read timed out'));
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([agent]));
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  expect(result.current.messages.map(message => message.id)).toEqual(['cached']);
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBe('Read timed out');
  expect(replaceMessages).not.toHaveBeenCalled();
  expect(setTailCursor).not.toHaveBeenCalled();
  expect(mockTailStarts).toEqual([]);
  await unmount();
});

it('refreshes a long background gap in one window while preserving the draft echo', async () => {
  mockRecentMessages = [turn('before-background')];
  mockProbe = { kind: 'size', bytes: 1000 };
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([agent]));
  jest.spyOn(client, 'sendPrompt').mockResolvedValue('delivered');
  const { result, rerender, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  await act(async () => { await result.current.send('Keep the unconfirmed echo'); });
  mockPolling = false;
  await rerender(undefined);
  mockRecentMessages = Array.from({ length: 150 }, (_, i) => turn(`while-away-${i}`, i + 100));
  mockProbe = { kind: 'size', bytes: 9_000_000 };
  mockPolling = true;
  await rerender(undefined);
  expect(result.current.messages).toHaveLength(151);
  expect(result.current.messages[0]?.id).toBe('while-away-0');
  expect(result.current.messages.at(-1)?.id).toMatch(/^local-/);
  expect(result.current.historyVersion).toBe(2);
  expect(mockTailStarts.at(-1)?.from).toBe(9_000_000);
  await unmount();
});

it('publishes both exact same-folder sessions together before starting either live tail', async () => {
  mockProbe = { kind: 'size', bytes: 1000 };
  mockRecent.mockImplementation(async path => ({
    messages: [turn(path)], consumedBytes: 1000, startByte: 0,
  }));
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([
    agent,
    { ...agent, paneId: 'second-pane', agentSession: { ...agent.agentSession!, value: 'second-session' } },
  ]));
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  expect(result.current.messages.map(message => message.id)).toEqual(['/test/session.jsonl', '/test/second-session.jsonl']);
  expect(replaceMessages).toHaveBeenCalledTimes(1);
  expect(mockTailStarts).toEqual([
    { path: '/test/session.jsonl', from: 1000 },
    { path: '/test/second-session.jsonl', from: 1000 },
  ]);
  await unmount();
});

it('discards a snapshot that finishes after its session has rotated', async () => {
  let finishOld: ((value: Awaited<ReturnType<typeof mockRecent>>) => void) | undefined;
  mockRecent.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  const fetch = jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([agent]));
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  fetch.mockResolvedValue(snapshot([{ ...agent, agentSession: { ...agent.agentSession!, value: 'new-session' } }]));
  mockRecentMessages = [turn('new-session-message')];
  await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
  await act(async () => { finishOld?.({ messages: [turn('foreign-old-message')], consumedBytes: 100, startByte: 0 }); });
  expect(result.current.messages.map(message => message.id)).toEqual(['new-session-message']);
  expect(replaceMessages).toHaveBeenCalledTimes(1);
  expect(mockTailStarts.every(source => source.path === '/test/new-session.jsonl')).toBe(true);
  await unmount();
});

it('still opens the healthy transcript when another agent cannot resolve its file', async () => {
  mockCodexPath.mockResolvedValue(null);
  mockRecentMessages = [turn('healthy-claude')];
  jest.spyOn(client, 'snapshot').mockResolvedValue(snapshot([
    agent, { ...agent, agent: 'codex', paneId: 'second-pane' },
  ]));
  const { result, unmount } = await renderHook(() => useThread(db, client, 'host', 'chat', []));
  expect(result.current.messages.map(message => message.id)).toEqual(['healthy-claude']);
  expect(result.current.error).toContain('Codex session is identified');
  expect(mockTailStarts).toEqual([{ path: '/test/session.jsonl', from: 0 }]);
  await unmount();
});
