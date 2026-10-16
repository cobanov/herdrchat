import { act, renderHook } from '@testing-library/react-native';

import type { ExecResult } from '../../../../modules/herdr-ssh/src';
import { HerdrClient } from '@/lib/herdr/client';
import type { HerdrTransport } from '@/lib/herdr/transport';
import { ABSENT_EXIT, workflowJournalPath, workflowRunPath } from '@/lib/subagents/paths';
import { useDelegationStates } from '../delegation';
import { WORKFLOW_POLL_MS, WORKFLOW_STALE_MS } from '@/lib/herdr/timeouts';
import { resetWorkflowRuns, resumeStaleRuns, useWorkflowRun } from '../useWorkflowRun';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/state/connections', () => ({ useConnections: () => null, clientFor: () => null }));
let mockPolling = true;
jest.mock('@/features/usePollGate', () => ({ usePollGate: () => mockPolling }));

const DIR = '/home/dev/.claude/projects/-home-dev-app/s1';
const RUN = 'wf_31a24808-cdf';

/** A host with whichever of the run's two files exist, answering the app's checksum reads. */
function host(files: Map<string, string>, calls: string[] = []) {
  const transport: HerdrTransport = {
    exec: async (command): Promise<ExecResult> => {
      calls.push(command);
      const path = /\[ -e '(.+?)' \]/.exec(command)?.[1] ?? '';
      const text = files.get(path);
      if (text === undefined) return { ok: true, exitCode: ABSENT_EXIT, stdout: '', stderr: '' };
      const signature = `${text.length} ${text.length}`;
      const asked = /\[ "\$s" = '(.*?)' \]/.exec(command)?.[1];
      return { ok: true, exitCode: 0, stdout: asked === signature ? `${signature}\n` : `${signature}\n${text}`, stderr: '' };
    },
    streamLines: async function* () {},
  };
  return new HerdrClient(transport);
}

beforeEach(() => {
  jest.useFakeTimers();
  resetWorkflowRuns();
  useDelegationStates.setState({ states: {} });
});
afterEach(() => {
  jest.useRealTimers();
  mockPolling = true;
});

// Claude writes the run file only when the run ends: while it runs, its
// agents are in the journal, and the run file wins once it appears.
it('follows a running run from its journal, then from its run file once written', async () => {
  const files = new Map([[workflowJournalPath(DIR, RUN), [
    '{"type":"launched"}',
    '{"type":"started","key":"k1","agentId":"a1","label":"check:links","phase":"Check"}',
  ].join('\n')]]);
  const client = host(files);
  const { result, rerender, unmount } = await renderHook(
    ({ running }: { running: boolean }) => useWorkflowRun(client, 'demo', [DIR], RUN, { active: true, awaitFile: running }),
    { initialProps: { running: true } }
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10);
  });
  expect(result.current).toMatchObject({ source: 'journal', dir: DIR, run: { status: null, phases: [{ title: 'Check', agents: [{ label: 'check:links', state: 'running' }] }] } });
  expect(useDelegationStates.getState().states[`${RUN}/a1`]).toBe('running');

  files.set(workflowJournalPath(DIR, RUN), `${files.get(workflowJournalPath(DIR, RUN))}\n{"type":"result","key":"k1","agentId":"a1","result":"ok"}`);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(3_000);
  });
  expect(result.current?.run?.phases[0]?.agents[0]?.state).toBe('done');
  expect(useDelegationStates.getState().states[`${RUN}/a1`]).toBe('done');

  files.set(workflowRunPath(DIR, RUN), JSON.stringify({
    workflowName: 'release-review', status: 'completed', durationMs: 60_000, totalTokens: 1_000,
    phases: [{ title: 'Check' }],
    workflowProgress: [{ type: 'workflow_agent', index: 1, label: 'check:links', phaseIndex: 1, agentId: 'a1', model: 'claude-opus-5', state: 'done', durationMs: 48_000 }],
  }));
  await rerender({ running: false });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(3_000);
  });
  expect(result.current).toMatchObject({ source: 'run', run: { name: 'release-review', status: 'completed', durationMs: 60_000 } });
  await unmount();
});

/** Time passing a poll at a time, each tick's reads landing before the next. */
async function poll(ms: number) {
  for (let left = ms; left > 0; left -= WORKFLOW_POLL_MS) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(Math.min(WORKFLOW_POLL_MS, left));
    });
  }
}

// A run whose session died writes no run file and no notification, so the
// transcript calls it running forever, and its chat read two files every
// three seconds for as long as it was open.
it('stops following a run that has not moved for the window, until a reload', async () => {
  const journal = workflowJournalPath(DIR, RUN);
  const files = new Map([[journal, '{"type":"launched"}']]);
  const calls: string[] = [];
  const client = host(files, calls);
  const { result, unmount } = await renderHook(() => useWorkflowRun(client, 'demo', [DIR], RUN, { active: true, awaitFile: true }));
  await poll(WORKFLOW_STALE_MS / 2);
  // A change halfway keeps it followed a whole window from then.
  files.set(journal, '{"type":"launched"}\n{"type":"started","key":"k1","agentId":"a1","label":"check","phase":"Check"}');
  await poll(WORKFLOW_STALE_MS / 2 + WORKFLOW_POLL_MS);
  expect(result.current?.stale).toBe(false);
  await poll(WORKFLOW_STALE_MS / 2);
  expect(result.current?.stale).toBe(true);
  const given = calls.length;
  await poll(WORKFLOW_POLL_MS * 10);
  expect(calls.length).toBe(given);

  // A reload follows it again.
  await act(async () => {
    resumeStaleRuns();
    await jest.advanceTimersByTimeAsync(WORKFLOW_POLL_MS);
  });
  expect(result.current?.stale).toBe(false);
  expect(calls.length).toBeGreaterThan(given);
  await unmount();
});

// The run id goes into a path on the host; one that is not inert is never read.
it('reads nothing for a run id that is not inert', async () => {
  const calls: string[] = [];
  const client = host(new Map(), calls);
  const { result, unmount } = await renderHook(() => useWorkflowRun(client, 'demo', [DIR], "wf_x'; rm -rf ~", { active: true, awaitFile: false }));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(WORKFLOW_POLL_MS * 3);
  });
  expect(calls).toEqual([]);
  expect(result.current).toMatchObject({ absent: true, error: 'not a run id this app reads' });
  await unmount();
});

// It polled every three seconds in the background too, where the app's other
// polls stop.
it('stops polling a running run while the app is paused', async () => {
  const files = new Map([[workflowJournalPath(DIR, RUN), '{"type":"launched"}']]);
  const client = host(files);
  const exec = jest.spyOn(client.transport, 'exec');
  mockPolling = false;
  const { unmount } = await renderHook(() => useWorkflowRun(client, 'demo', [DIR], RUN, { active: true, awaitFile: true }));
  await act(async () => { await jest.advanceTimersByTimeAsync(10_000); });
  expect(exec).not.toHaveBeenCalled();
  await unmount();
});
