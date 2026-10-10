import { act, renderHook } from '@testing-library/react-native';

import type { ExecResult } from '../../../../modules/herdr-ssh/src';
import { HerdrClient } from '@/lib/herdr/client';
import type { HerdrTransport } from '@/lib/herdr/transport';
import { ABSENT_EXIT, workflowJournalPath, workflowRunPath } from '@/lib/subagents/paths';
import { useDelegationStates } from '../delegation';
import { resetWorkflowRuns, useWorkflowRun } from '../useWorkflowRun';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/state/connections', () => ({ useConnections: () => null, clientFor: () => null }));

const DIR = '/home/dev/.claude/projects/-home-dev-app/s1';
const RUN = 'wf_31a24808-cdf';

/** A host with whichever of the run's two files exist, answering the app's checksum reads. */
function host(files: Map<string, string>) {
  const transport: HerdrTransport = {
    exec: async (command): Promise<ExecResult> => {
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
afterEach(() => jest.useRealTimers());

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
