import { act, renderHook } from '@testing-library/react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { DemoHost } from '@/lib/demo/host';
import { HerdrClient } from '@/lib/herdr/client';
import type { HerdrTransport } from '@/lib/herdr/transport';
import { useWorkspaces } from '../../chats/useWorkspaces';
import { useThread } from '../useThread';

/**
 * What an open chat costs the host, counted. Each `exec` is an SSH channel, a
 * login shell and often a Python process on the host, so the count per minute
 * is the number that a phone's battery and a slow link feel. The Demo host
 * stands in for herdr; the real store, client and hook do the asking.
 */

let mockLive = false;
jest.mock('../../usePollGate', () => ({ usePollGate: () => true }));
jest.mock('../../useHostEvents', () => ({ useHostEvents: () => mockLive }));
jest.mock('../useReportPresence', () => ({ useReportPresence: () => undefined }));
jest.mock('@/state/settings', () => ({ useSettings: () => 1 }));
jest.mock('@/state/threadCache', () => ({
  appendMessages: jest.fn(async () => undefined),
  rebind: jest.fn(async () => false),
  replaceMessages: jest.fn(async () => undefined),
  seedMessages: jest.fn(async () => []),
  setTailCursor: jest.fn(async () => undefined),
  tailCursor: jest.fn(async () => null),
}));

const db = {
  runAsync: jest.fn(async () => undefined),
  withTransactionAsync: jest.fn(async (task: () => Promise<void>) => task()),
} as unknown as SQLiteDatabase;

/** The Demo host, with every command it is asked to run written down. */
function countingHost(): { transport: HerdrTransport; commands: string[] } {
  const host = new DemoHost();
  const commands: string[] = [];
  return {
    commands,
    transport: {
      exec: (command, timeoutMs) => {
        commands.push(command);
        return host.exec(command, timeoutMs);
      },
      streamLines: (command, timeoutMs, signal) => host.streamLines(command, timeoutMs, signal),
    },
  };
}

/**
 * One minute of a thread on screen: the commands it ran, after it opened.
 * `both` puts the chat list beside it on the same client, as on iPad; `list`
 * is the list alone, as on a phone.
 */
async function oneMinute(workspaceId: string, pane?: string, shown: 'chat' | 'list' | 'both' = 'chat'): Promise<string[]> {
  const { transport, commands } = countingHost();
  const client = new HerdrClient(transport);
  const { unmount } = await renderHook(() => {
    if (shown !== 'list') useThread(db, client, 'demo', workspaceId, [], pane);
    if (shown !== 'chat') useWorkspaces(client);
  });
  for (let second = 0; second < 10; second += 1) {
    await act(async () => { await jest.advanceTimersByTimeAsync(1_000); });
  }
  const opened = commands.length;
  for (let second = 0; second < 60; second += 1) {
    await act(async () => { await jest.advanceTimersByTimeAsync(1_000); });
  }
  await unmount();
  if (process.env.BUDGET_DEBUG) console.log(commands.slice(opened).map((c) => c.replace(/^export PATH=[^;]*; /, '').slice(0, 90)).join('\n'));
  return commands.slice(opened);
}

const isSnapshot = (command: string) => command.includes("'api' 'snapshot'");

beforeEach(() => {
  jest.useFakeTimers();
  mockLive = false;
});
afterEach(() => jest.useRealTimers());

// The budget: a change that makes an open chat ask more fails here. Lower a
// number when a change earns it. `BUDGET_DEBUG=1` prints what was asked.
it('keeps an open chat within its budget of host commands each minute', async () => {
  expect((await oneMinute('w6', 'w6:p2')).length).toBeLessThanOrEqual(60); // an agent at work
  expect((await oneMinute('w2')).length).toBeLessThanOrEqual(30); // idle, no event stream
  mockLive = true;
  expect((await oneMinute('w2')).length).toBeLessThanOrEqual(2); // idle, events live
});

// On iPad the list sits beside the open chat. The chat's poll reads the host
// every couple of seconds; the list's own timer reading it again on its own
// schedule asked for every snapshot twice.
it('reads one snapshot per interval with the list beside an open chat', async () => {
  for (const [workspaceId, pane] of [['w2', undefined], ['w6', 'w6:p2']] as const) {
    const alone = (await oneMinute(workspaceId, pane)).filter(isSnapshot).length;
    const beside = (await oneMinute(workspaceId, pane, 'both')).filter(isSnapshot).length;
    if (process.env.BUDGET_DEBUG) console.log(workspaceId, { alone, beside });
    expect(alone).toBeGreaterThan(0);
    expect(beside).toBe(alone);
  }
  // Alone, as on a phone, the list still reads its own every three seconds.
  expect((await oneMinute('w2', undefined, 'list')).filter(isSnapshot)).toHaveLength(20);
});
