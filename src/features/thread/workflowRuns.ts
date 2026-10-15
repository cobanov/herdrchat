import { create } from 'zustand';

import type { WorkflowRun } from '@/lib/subagents/workflowRun';

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
  /** When this run was first looked for, and when its files last changed after that, epoch ms. */
  seenAt: number | null;
  changedAt: number | null;
  /** When a reload last asked for it to be followed again. */
  resumedAt: number | null;
  /**
   * The transcript still calls it running but nothing has moved for
   * `WORKFLOW_STALE_MS`: its session most likely died. Not polled until a
   * reload, or until the transcript says it ended.
   */
  stale: boolean;
}

export const EMPTY_RUN: RunEntry = {
  run: null,
  signature: null,
  source: null,
  dir: null,
  absent: false,
  final: false,
  error: null,
  seenAt: null,
  changedAt: null,
  resumedAt: null,
  stale: false,
};

/**
 * Runs by host and run id, outside the rows and screens that show them: the
 * card in the thread and the run's screen read one file, once, and FlashList
 * recycles rows, so state kept in a card would show another card's run.
 */
export const useRuns = create<{ entries: Readonly<Record<string, RunEntry>>; put: (key: string, entry: RunEntry) => void }>((set) => ({
  entries: {},
  put: (key, entry) => set((state) => ({ entries: { ...state.entries, [key]: entry } })),
}));

/**
 * Follow every run that went quiet again, from now: what a reload of the
 * thread does, so a run given up on is one tap from being looked at again.
 */
export function resumeStaleRuns() {
  const now = Date.now();
  useRuns.setState((state) => ({
    entries: Object.fromEntries(Object.entries(state.entries).map(([key, entry]) => [
      key,
      entry.stale ? { ...entry, stale: false, resumedAt: now } : entry,
    ])),
  }));
}
