import { useEffect } from 'react';
import { create } from 'zustand';

import { useDelegationStates, workflowAgentKey } from '@/features/thread/delegation';
import type { HerdrClient } from '@/lib/herdr/client';
import { WORKFLOW_POLL_MS } from '@/lib/herdr/timeouts';
import { workflowJournalPath, workflowRunPath } from '@/lib/subagents/paths';
import { SubagentReader } from '@/lib/subagents/reader';
import { agentState, isRunning, parseWorkflowJournal, parseWorkflowRun, type WorkflowRun } from '@/lib/subagents/workflowRun';
import type { DelegationState } from '@/lib/threadItems';

/**
 * What the app knows of one workflow run: the last good read of its file,
 * the checksum it had (so the next read downloads it only when it changed),
 * and the session folder it was found in.
 *
 * `source` says which file that was. Claude writes the run file only when
 * the run ends; while it runs, its agents are read from the run's journal,
 * and the run file wins as soon as it appears.
 */
export interface RunEntry {
  run: WorkflowRun | null;
  signature: string | null;
  source: 'run' | 'journal' | null;
  dir: string | null;
  /** No session folder has the run file or its journal: not started yet, or cleaned up. */
  absent: boolean;
  /** Read after the transcript said the run ended: what it shows is all there will be. */
  final: boolean;
  error: string | null;
}

const EMPTY: RunEntry = { run: null, signature: null, source: null, dir: null, absent: false, final: false, error: null };

/**
 * Runs by host and run id, outside the rows and screens that show them: the
 * card in the thread and the run's screen read one file, once, and FlashList
 * recycles rows, so state kept in a card would show another card's run.
 */
const useRuns = create<{ entries: Readonly<Record<string, RunEntry>>; put: (key: string, entry: RunEntry) => void }>((set) => ({
  entries: {},
  put: (key, entry) => set((state) => ({ entries: { ...state.entries, [key]: entry } })),
}));

const inflight = new Map<string, Promise<void>>();

const runKey = (connectionId: string, runId: string) => `${connectionId}\u0000${runId}`;

/**
 * Read a run's file again if it changed. One read at a time per run: the
 * card and the screen polling together share it.
 */
export function refreshRun(
  client: HerdrClient,
  connectionId: string,
  dirs: readonly string[],
  runId: string,
  ended = false
): Promise<void> {
  const key = runKey(connectionId, runId);
  const running = inflight.get(key);
  if (running !== undefined) return running;
  const read = (async () => {
    const { entries, put } = useRuns.getState();
    const current = entries[key] ?? EMPTY;
    const reader = new SubagentReader(client.transport);
    // The folder it was found in, once found; until then each folder in turn,
    // by the run's own id, so a second folder can only ever hold this run.
    for (const dir of current.dir === null ? dirs : [current.dir]) {
      const same = (source: RunEntry['source']) => (current.dir === dir && current.source === source ? current.signature : null);
      let source: 'run' | 'journal' = 'run';
      let result = await reader.readIfChanged(workflowRunPath(dir, runId), same('run'));
      if (result.kind === 'absent') {
        // Not ended yet: the journal is where its agents are.
        source = 'journal';
        result = await reader.readIfChanged(workflowJournalPath(dir, runId), same('journal'));
      }
      if (result.kind === 'absent') continue;
      if (result.kind === 'unknown') {
        put(key, { ...current, final: current.final || ended, error: result.reason });
        return;
      }
      if (result.kind === 'unchanged') {
        if (current.error !== null || current.final !== ended) put(key, { ...current, final: current.final || ended, error: null });
        return;
      }
      const run = source === 'run' ? parseWorkflowRun(result.text, current.run) : parseWorkflowJournal(result.text) ?? current.run;
      // A half-written file parses to the last good run: keep the old
      // checksum, so the next poll reads the finished file instead of
      // skipping it as unchanged.
      const parsed = run !== null && run !== current.run;
      put(key, {
        run,
        signature: parsed ? result.signature : current.signature,
        source: parsed ? source : current.source,
        dir,
        absent: false,
        final: current.final || ended,
        error: null,
      });
      if (parsed) reportAgents(runId, run);
      return;
    }
    put(key, { ...current, absent: true, final: current.final || ended, error: null });
  })()
    .catch((thrown: unknown) => {
      const { entries, put } = useRuns.getState();
      put(key, { ...(entries[key] ?? EMPTY), error: thrown instanceof Error ? thrown.message : String(thrown) });
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, read);
  return read;
}

/** Tell any open agent screen of this run where its agent stands. */
function reportAgents(runId: string, run: WorkflowRun) {
  const { report } = useDelegationStates.getState();
  for (const phase of run.phases) {
    for (const agent of phase.agents) {
      if (agent.agentId !== null) report(workflowAgentKey(runId, agent.agentId), agent.state);
    }
  }
}

/** A run's state as a card shows it: its file's status once read, else what the transcript said. */
export function runState(run: WorkflowRun | null, fallback: DelegationState): DelegationState {
  if (run === null || run.status === null) return fallback;
  if (isRunning(run.status)) return 'running';
  return agentState(run.status) === 'failed' ? 'failed' : 'done';
}

/**
 * A workflow run, read while `active` and polled every `WORKFLOW_POLL_MS`
 * while it is still running. A finished run already read is not read again.
 * `awaitFile` is whether the transcript says the run is still going: while it
 * is, a run with no file is looked for again (it has not started writing),
 * and one read from its journal is followed until its run file appears. Once
 * it is not, one more read settles it: a run whose files were cleaned up, or
 * that ended without a run file, is not polled for as long as it is shown.
 * Undefined until the first read lands.
 */
export function useWorkflowRun(
  client: HerdrClient | null,
  connectionId: string,
  dirs: readonly string[],
  runId: string | null,
  { active, awaitFile }: { active: boolean; awaitFile: boolean }
): RunEntry | undefined {
  const entry = useRuns((state) => (runId === null ? undefined : state.entries[runKey(connectionId, runId)]));
  const settled = (entry?.source === 'run' && entry.run !== null && !isRunning(entry.run.status)) || (entry?.final === true && !awaitFile);
  // An array param re-made by every render must not restart the poll.
  const dirsKey = dirs.join('\u0000');

  useEffect(() => {
    if (!active || settled || client === null || runId === null || dirsKey.length === 0) return;
    const folders = dirsKey.split('\u0000');
    const ended = !awaitFile;
    void refreshRun(client, connectionId, folders, runId, ended);
    const timer = setInterval(() => void refreshRun(client, connectionId, folders, runId, ended), WORKFLOW_POLL_MS);
    return () => clearInterval(timer);
  }, [active, settled, awaitFile, client, connectionId, dirsKey, runId]);

  return entry;
}

/** For tests: forget every run read so far. */
export function resetWorkflowRuns() {
  useRuns.setState({ entries: {} });
  inflight.clear();
}
