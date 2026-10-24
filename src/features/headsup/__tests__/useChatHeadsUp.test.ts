import { act, renderHook } from '@testing-library/react-native';

import { DEMO_HEADSUP_PATH, demoHeadsUpStore } from '@/lib/demo/scenarios';
import { HEADSUP_READ_INTERVAL_MS } from '@/lib/headsup/client';
import { parseHeadsUpFile } from '@/lib/headsup/items';
import type { AgentInfo } from '@/lib/herdr/models';
import type { HerdrTransport } from '@/lib/herdr/transport';
import { resetHeadsUpSession, useHeadsUp } from '@/state/headsUp';
import { chatHeadsUpSession, useChatHeadsUp } from '../useChatHeadsUp';

const mockCheck = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('@/state/headsUp', () => ({
  ...jest.requireActual('@/state/headsUp'),
  checkHeadsUp: (...args: unknown[]) => mockCheck(...args),
}));

const ASKER = '22222222-2222-4222-8222-222222222222';
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

function hold(tweak: (raw: Record<string, unknown>) => Record<string, unknown> = (raw) => raw) {
  const raw = tweak(demoHeadsUpStore({ sessionId: ASKER, folder: 'notes' }, Date.now()));
  useHeadsUp.getState().update('demo', () => ({
    path: DEMO_HEADSUP_PATH, detectedAt: 1, version: '1 1', file: parseHeadsUpFile(JSON.stringify(raw)), chats: [],
  }));
}

beforeEach(() => {
  resetHeadsUpSession();
  mockCheck.mockClear();
  jest.useRealTimers();
});

describe('chatHeadsUpSession', () => {
  it('is the session the composer sends to: the focused Claude agent of several, never another', () => {
    const asker = agent('w1:p1', { agentSession: session(ASKER) });
    const focused = agent('w1:p2', { agentSession: session(OTHER), focused: true });
    expect(chatHeadsUpSession([asker, focused])).toBe(OTHER);
    expect(chatHeadsUpSession([asker])).toBe(ASKER);
  });

  it('is empty for a chat that sends to another agent, or a Claude without a session yet', () => {
    expect(chatHeadsUpSession([agent('w1:p1', { agent: 'codex', agentSession: session(ASKER) })])).toBe('');
    expect(chatHeadsUpSession([agent('w1:p1', { agentSession: null })])).toBe('');
    expect(chatHeadsUpSession([])).toBe('');
  });
});

describe('useChatHeadsUp', () => {
  it('shows the asking session’s open questions and follow-ups, the blocking one first', async () => {
    hold();
    const { result } = await renderHook(() => useChatHeadsUp('demo', transport, [agent('w1:p1', { agentSession: session(ASKER) })], true));
    expect(result.current.items.map((item) => item.id)).toEqual(['demohu1q', 'demohu3f']);
    expect(result.current.sessionIds).toEqual([ASKER]);
  });

  it('shows nothing of a session this chat does not send to, as in a workspace chat focused on another agent', async () => {
    hold();
    const agents = [agent('w1:p1', { agentSession: session(ASKER) }), agent('w1:p2', { agentSession: session(OTHER), focused: true })];
    const { result } = await renderHook(() => useChatHeadsUp('demo', transport, agents, true));
    expect(result.current.items).toEqual([]);
    expect(result.current.sessionIds).toEqual([OTHER]);
  });

  it('never matches a non-Claude agent’s session', async () => {
    hold();
    const { result } = await renderHook(() => useChatHeadsUp('demo', transport, [agent('w1:p1', { agent: 'codex', agentSession: session(ASKER) })], true));
    expect(result.current.items).toEqual([]);
  });

  it('drops a question once it is replied to, so Answer is not offered twice', async () => {
    hold((raw) => ({ ...raw, items: (raw.items as Record<string, unknown>[]).map((item) => (item.id === 'demohu1q' ? { ...item, repliedAt: 5 } : item)) }));
    const { result } = await renderHook(() => useChatHeadsUp('demo', transport, [agent('w1:p1', { agentSession: session(ASKER) })], true));
    expect(result.current.items.map((item) => item.id)).toEqual(['demohu3f']);
  });

  it('shows nothing on a host without the mod', async () => {
    useHeadsUp.getState().update('demo', (entry) => ({ ...entry, path: null, detectedAt: 1 }));
    const { result } = await renderHook(() => useChatHeadsUp('demo', transport, [agent('w1:p1', { agentSession: session(ASKER) })], true));
    expect(result.current.items).toEqual([]);
  });

  it('reads the list on open and again on the cadence while on screen, and not at all off it', async () => {
    jest.useFakeTimers();
    const agents = [agent('w1:p1', { agentSession: session(ASKER) })];
    const { rerender, unmount } = await renderHook(({ active }: { active: boolean }) => useChatHeadsUp('demo', transport, agents, active), {
      initialProps: { active: true },
    });
    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(mockCheck).toHaveBeenLastCalledWith('demo', transport);
    // A poll's new agents array with the same session starts no new check.
    await rerender({ active: true });
    expect(mockCheck).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(HEADSUP_READ_INTERVAL_MS); });
    expect(mockCheck).toHaveBeenCalledTimes(2);
    await rerender({ active: false });
    await act(async () => { jest.advanceTimersByTime(HEADSUP_READ_INTERVAL_MS * 3); });
    expect(mockCheck).toHaveBeenCalledTimes(2);
    await unmount();
  });

  it('checks nothing without a connection', async () => {
    await renderHook(() => useChatHeadsUp(null, null, [], true));
    expect(mockCheck).not.toHaveBeenCalled();
  });
});
