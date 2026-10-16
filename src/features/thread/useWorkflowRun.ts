import { useEffect } from 'react';

import { usePollGate } from '@/features/usePollGate';
import { useDelegationStates, workflowAgentKey } from '@/features/thread/delegation';
import { EMPTY_RUN as EMPTY, useRuns, type RunEntry } from '@/features/thread/workflowRuns';
import type { HerdrClient } from '@/lib/herdr/client';
import { WORKFLOW_POLL_MS } from '@/lib/herdr/timeouts';
import { isInertId, workflowJournalPath, workflowRunPath } from '@/lib/subagents/paths';
import { SubagentReader } from '@/lib/subagents/reader';
import {
  agentState,
  isRunning,
  isRunStale,
  parseWorkflowJournal,
  parseWorkflowRun,
  type WorkflowRun,
} from '@/lib/subagents/workflowRun';
import type { DelegationState } from '@/lib/threadItems';
import { errorText } from '@/lib/herdr/protocol';

export { resumeStaleRuns, type RunEntry } from '@/features/thread/workflowRuns';

const inflight = new Map<string, Promise<void>>();

const runKey = (connectionId: string, runId: string) => `${connectionId}\u0000${runId}`;

/**
 * Read a run's file again if it changed. One read at a time per run: the
 * card and the screen polling together share it. `ended` is whether the
 * transcript says the run is over.
 */
export function refreshRun(
  client: HerdrClient,
  connectionId: string,
  dirs: readonly string[],
  runId: string,
  { ended = false }: { ended?: boolean } = {}
): Promise<void> {
  const key = runKey(connectionId, runId);
  const running = inflight.get(key);
  if (running !== undefined) return running;
  // The id goes into a path on the host, like every other id read there.
  if (!isInertId(runId)) {
    const { entries, put } = useRuns.getState();
    if (entries[key] === undefined) put(key, { ...EMPTY, absent: true, final: true, error: 'not a run id this app reads' });
    return Promise.resolve();
  }
  const read = (async () => {
    const { entries, put: store } = useRuns.getState();
    const now = Date.now();
    const current = { ...(entries[key] ?? EMPTY), seenAt: entries[key]?.seenAt ?? now };
    // Every write says whether the run has gone quiet, measured from its
    // newest sign of life; one the transcript says ended never is. Not from
    // its launch: a run launched long ago, read for the first time now (a
    // chat opened today on yesterday's work), gets a window of its own.
    const staleness = (next: RunEntry) => !ended && isRunStale([next.seenAt, next.changedAt, next.resumedAt], now);
    const put = (k: string, next: RunEntry) => store(k, { ...next, stale: staleness(next) });
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
        // Written only when what it shows moved: an unchanged file is the
        // usual answer, and a new entry each time redraws every card on it.
        const next = { ...current, final: current.final || ended, error: null };
        if (current.error !== null || current.final !== next.final || current.stale !== staleness(next)) put(key, next);
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
        seenAt: current.seenAt,
        // The first look finds whatever is there, however old; what changes after it is the run moving.
        changedAt: parsed && entries[key] !== undefined ? now : current.changedAt,
        resumedAt: current.resumedAt,
        stale: false,
      });
      if (parsed) reportAgents(runId, run);
      return;
    }
    put(key, { ...current, absent: true, final: current.final || ended, error: null });
  })()
    .catch((thrown: unknown) => {
      const { entries, put } = useRuns.getState();
      put(key, { ...(entries[key] ?? EMPTY), error: errorText(thrown) });
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
 * Nor is one still "running" whose files have not moved for
 * `WORKFLOW_STALE_MS` since it was first looked for: its session died before
 * it could say so (`entry.stale`, until `resumeStaleRuns`).
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
  const settled = (entry?.source === 'run' && entry.run !== null && !isRunning(entry.run.status)) ||
    (entry?.final === true && !awaitFile) ||
    (entry?.stale === true && awaitFile);
  // An array param re-made by every render must not restart the poll.
  const dirsKey = dirs.join('\u0000');
  // Paused with the app's other polls: in the background, or under a sheet.
  const polling = usePollGate();

  useEffect(() => {
    if (!active || !polling || settled || client === null || runId === null || dirsKey.length === 0) return;
    const folders = dirsKey.split('\u0000');
    const options = { ended: !awaitFile };
    void refreshRun(client, connectionId, folders, runId, options);
    const timer = setInterval(() => void refreshRun(client, connectionId, folders, runId, options), WORKFLOW_POLL_MS);
    return () => clearInterval(timer);
  }, [active, polling, settled, awaitFile, client, connectionId, dirsKey, runId]);

  return entry;
}

/** For tests: forget every run read so far. */
export function resetWorkflowRuns() {
  useRuns.setState({ entries: {} });
  inflight.clear();
}
