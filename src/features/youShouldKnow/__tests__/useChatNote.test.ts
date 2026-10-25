import { act, renderHook } from '@testing-library/react-native';

import { DEMO_YSK_PATH, demoYskStore } from '@/lib/demo/scenarios';
import { YSK_READ_INTERVAL_MS } from '@/lib/youShouldKnow/client';
import { parseYskFile } from '@/lib/youShouldKnow/notes';
import type { AgentInfo } from '@/lib/herdr/models';
import type { HerdrTransport } from '@/lib/herdr/transport';
import { resetYouShouldKnowSession, useYouShouldKnow } from '@/state/youShouldKnow';
import { useChatNote } from '../useChatNote';

const mockCheck = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('@/state/youShouldKnow', () => ({
  ...jest.requireActual('@/state/youShouldKnow'),
  checkYouShouldKnow: (...args: unknown[]) => mockCheck(...args),
}));

const MINE = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const transport: HerdrTransport = { exec: jest.fn(), streamLines: jest.fn() } as unknown as HerdrTransport;

function agent(paneId: string, overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    agent: 'claude', agentStatus: 'idle', cwd: '/x', foregroundCwd: null, focused: false, paneId, tabId: 't', terminalId: null,
    workspaceId: 'w1', agentSession: { agent: 'claude', kind: 'id', source: 'herdr:claude', value: `s-${paneId}` },
    stateChangeSeq: null, completionSeq: null, ...overrides,
  } as AgentInfo;
}
const session = (value: string) => ({ agent: 'claude', kind: 'id', source: 'herdr:claude', value }) as AgentInfo['agentSession'];

function hold() {
  useYouShouldKnow.getState().update('demo', () => ({
    path: DEMO_YSK_PATH, detectedAt: 1, version: '1 1', file: parseYskFile(JSON.stringify(demoYskStore(MINE, Date.now()))), chats: [],
  }));
}

beforeEach(() => {
  resetYouShouldKnowSession();
  mockCheck.mockClear();
  jest.useRealTimers();
});

it('is the note of the session the chat sends to', async () => {
  hold();
  const { result } = await renderHook(() => useChatNote('demo', transport, [agent('w1:p1', { agentSession: session(MINE) })], true));
  expect(result.current).toMatchObject({ sessionId: MINE, tag: 'Heads up', view: { kind: 'offer' } });
});

it('is nothing for a session this chat does not send to, as in a workspace chat focused on another agent', async () => {
  hold();
  const agents = [agent('w1:p1', { agentSession: session(MINE) }), agent('w1:p2', { agentSession: session(OTHER), focused: true })];
  const { result } = await renderHook(() => useChatNote('demo', transport, agents, true));
  expect(result.current).toBeNull();
});

it('never matches a non-Claude agent’s session', async () => {
  hold();
  const { result } = await renderHook(() => useChatNote('demo', transport, [agent('w1:p1', { agent: 'codex', agentSession: session(MINE) })], true));
  expect(result.current).toBeNull();
});

it('is nothing on a host without the plugin', async () => {
  useYouShouldKnow.getState().update('demo', (entry) => ({ ...entry, path: null, detectedAt: 1 }));
  const { result } = await renderHook(() => useChatNote('demo', transport, [agent('w1:p1', { agentSession: session(MINE) })], true));
  expect(result.current).toBeNull();
});

it('reads the store on open and again on the cadence while on screen, and not at all off it', async () => {
  jest.useFakeTimers();
  const agents = [agent('w1:p1', { agentSession: session(MINE) })];
  const { rerender, unmount } = await renderHook(({ active }: { active: boolean }) => useChatNote('demo', transport, agents, active), {
    initialProps: { active: true },
  });
  expect(mockCheck).toHaveBeenCalledTimes(1);
  expect(mockCheck).toHaveBeenLastCalledWith('demo', transport);
  // A poll's new agents array with the same session starts no new check.
  await rerender({ active: true });
  expect(mockCheck).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(YSK_READ_INTERVAL_MS); });
  expect(mockCheck).toHaveBeenCalledTimes(2);
  await rerender({ active: false });
  await act(async () => { jest.advanceTimersByTime(YSK_READ_INTERVAL_MS * 3); });
  expect(mockCheck).toHaveBeenCalledTimes(2);
  await unmount();
});

it('checks nothing without a connection', async () => {
  await renderHook(() => useChatNote(null, null, [], true));
  expect(mockCheck).not.toHaveBeenCalled();
});
