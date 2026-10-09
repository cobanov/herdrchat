import { act, renderHook } from '@testing-library/react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { DemoHost } from '@/lib/demo/host';
import { DEMO_SESSION_IDS, DEMO_WORKSPACES } from '@/lib/demo/fixtures';
import { DELEGATE_RESULT, DEMO_LINKS } from '@/lib/demo/subagents';
import { HerdrClient } from '@/lib/herdr/client';
import { agentTranscriptPath, sessionDir } from '@/lib/subagents/paths';
import { SubagentReader } from '@/lib/subagents/reader';
import { displayText, type ChatMessage } from '@/lib/transcript/message';
import { TranscriptStore } from '@/lib/transcript/store';
import { appendMessages, rebind, replaceMessages, seedMessages } from '@/state/threadCache';
import { transcriptCacheKey, useTranscript } from '../useTranscript';

jest.mock('@/state/threadCache', () => ({
  appendMessages: jest.fn(async () => undefined),
  rebind: jest.fn(async () => false),
  replaceMessages: jest.fn(async () => undefined),
  seedMessages: jest.fn(async () => []),
}));

const db = {} as SQLiteDatabase;

/** The Demo, on a clock the test moves, and the notes chat's session folder. */
async function demo() {
  let now = 1_000;
  const host = new DemoHost(() => now);
  const streams: (AbortSignal | undefined)[] = [];
  const stream = host.streamLines.bind(host);
  jest.spyOn(host, 'streamLines').mockImplementation((command, timeout, signal) => {
    streams.push(signal);
    return stream(command, timeout, signal);
  });
  const store = new TranscriptStore(host);
  const workspace = DEMO_WORKSPACES[1]!;
  const main = store.sessionTranscriptPath(await store.homeDirectory(), workspace.cwd, DEMO_SESSION_IDS[workspace.paneId]!)!;
  return {
    host,
    client: new HerdrClient(host),
    dir: sessionDir(main)!,
    streams,
    tick: (ms: number) => {
      now += ms;
    },
  };
}

const texts = (messages: readonly ChatMessage[]) => messages.map(displayText).filter((text) => text.length > 0);

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => {
  jest.useRealTimers();
});

it('opens a finished subagent on its whole transcript, caches it under its agent id, and does not follow it', async () => {
  const { client, dir, streams } = await demo();
  const path = agentTranscriptPath(dir, DEMO_LINKS.agentId);
  const { result, unmount } = await renderHook(() => useTranscript(db, client, 'demo', 'w2', path, false));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10);
  });
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBeNull();
  expect(result.current.messages).toHaveLength(6);
  expect(result.current.messages.every((message) => message.isSidechain)).toBe(true);
  expect(texts(result.current.messages).at(-1)).toContain('returns 404');
  expect(result.current.reachedStart).toBe(true);

  const key = transcriptCacheKey('w2', DEMO_LINKS.agentId);
  expect(key).toBe(`w2/agent:${DEMO_LINKS.agentId}`);
  expect(rebind).toHaveBeenCalledWith(db, 'demo', key, DEMO_LINKS.agentId);
  expect(seedMessages).toHaveBeenCalledWith(db, 'demo', key);
  expect(replaceMessages).toHaveBeenCalledWith(db, 'demo', key, DEMO_LINKS.agentId, result.current.messages);
  expect(streams).toHaveLength(0);
  await unmount();
});

it('opens on the cached copy before the host answers', async () => {
  const { client, dir } = await demo();
  const cached: ChatMessage = {
    id: 'dl-1', role: 'user', segments: [{ kind: 'text', text: 'cached prompt' }], timestamp: 1, agentLabel: null, isSidechain: true,
  };
  jest.mocked(seedMessages).mockResolvedValueOnce([cached]);
  const { result, unmount } = await renderHook(() =>
    useTranscript(db, client, 'demo', 'w2', agentTranscriptPath(dir, DEMO_LINKS.agentId), false));
  // The window continues the cache (same first line), so the list is not rebuilt.
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10);
  });
  expect(result.current.messages).toHaveLength(6);
  expect(result.current.historyVersion).toBe(0);
  await unmount();
});

/** Start the Demo's delegate scenario and find the agent it starts, once its meta is written. */
async function delegated(setup: Awaited<ReturnType<typeof demo>>) {
  const { client, dir, tick } = setup;
  await client.sendPrompt('w2:p1', 'please delegate the review');
  tick(1_500);
  const { messages } = await new TranscriptStore(client.transport).recent(`${dir}.jsonl`, null, 400);
  const call = messages.flatMap((message) => message.segments).filter((segment) => segment.kind === 'toolUse').at(-1);
  if (call?.kind !== 'toolUse' || call.id === undefined) throw new Error('the scenario made no call');
  const resolved = await new SubagentReader(client.transport).resolve(dir, call.id);
  if (resolved === null) throw new Error('the scenario wrote no meta');
  return agentTranscriptPath(dir, resolved.agentId);
}

it('follows a running subagent as its transcript grows, and stops when it ends', async () => {
  const setup = await demo();
  const { client, streams, tick } = setup;
  const path = await delegated(setup);

  const { result, rerender, unmount } = await renderHook(
    ({ follow }: { follow: boolean }) => useTranscript(db, client, 'demo', 'w2', path, follow),
    { initialProps: { follow: true } }
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10);
  });
  expect(result.current.messages).toHaveLength(1);
  expect(streams).toHaveLength(1);

  // The agent works: its lines arrive through the live stream.
  tick(2_500);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(500);
  });
  expect(result.current.messages).toHaveLength(3);
  expect(appendMessages).toHaveBeenCalled();

  // Its result lands and the card says done: the stream closes, and what it
  // had not delivered yet is read once.
  tick(2_500);
  await rerender({ follow: false });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10);
  });
  expect(streams[0]?.aborted).toBe(true);
  expect(result.current.messages).toHaveLength(4);
  expect(texts(result.current.messages).at(-1)).toBe(DELEGATE_RESULT);
  expect(streams).toHaveLength(1);
  await unmount();
});

it('waits for a transcript that is not written yet, and reads it once it is', async () => {
  // The Demo is deterministic: a first run names the agent a second one starts.
  const path = await delegated(await demo());
  const { client, tick } = await demo();
  await client.sendPrompt('w2:p1', 'please delegate the review');
  const { result, unmount } = await renderHook(() => useTranscript(db, client, 'demo', 'w2', path, true));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10);
  });
  expect(result.current.absent).toBe(true);
  expect(result.current.loading).toBe(false);
  expect(result.current.messages).toEqual([]);

  tick(1_500);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(2_100);
  });
  expect(result.current.absent).toBe(false);
  expect(result.current.messages).toHaveLength(1);
  await unmount();
});
