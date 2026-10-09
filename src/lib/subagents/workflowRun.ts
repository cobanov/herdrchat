/**
 * A workflow run, read from `<session>/workflows/<runId>.json`.
 *
 * Claude rewrites the file as the run goes, so a read can land on a half
 * written one: `parseWorkflowRun` keeps the last good value rather than
 * blanking the screen. The keys that matter, as measured (2.1.294):
 *
 *     workflowName, summary, status ("running", "completed", "failed", "killed"),
 *     phases: [{title, detail, model?}],
 *     workflowProgress: [
 *       {type: "workflow_phase", index: 1, title},
 *       {type: "workflow_agent", index, label, phaseIndex: 1, phaseTitle, agentId,
 *        model, state ("start", "progress", "done", "error"), startedAt, durationMs,
 *        tokens, toolCalls, lastToolName, lastToolSummary, resultPreview, error}
 *     ],
 *     logs: ["…"], agentCount, totalTokens, durationMs, result
 *
 * `phaseIndex` and the phase entries' `index` count from 1; `phases` is a
 * plain list in the same order.
 */

export type WorkflowAgentState = 'running' | 'done' | 'failed';

export interface WorkflowAgent {
  index: number;
  label: string;
  agentId: string | null;
  model: string | null;
  state: WorkflowAgentState;
  startedAt: number | null;
  durationMs: number | null;
  tokens: number | null;
  toolCalls: number | null;
  /** What it is doing now: `Bash: npm test`. */
  lastTool: string | null;
  resultPreview: string | null;
  error: string | null;
}

export interface WorkflowPhase {
  title: string;
  detail: string | null;
  agents: WorkflowAgent[];
}

export interface WorkflowRun {
  name: string | null;
  summary: string | null;
  /** As Claude writes it; `isRunning` says what it means. */
  status: string | null;
  phases: WorkflowPhase[];
  logs: string[];
  durationMs: number | null;
  agentCount: number | null;
  totalTokens: number | null;
}

/** Whether a run is still going: polled while it is, left alone once it is not. */
export function isRunning(status: string | null): boolean {
  return status === null || status === 'running' || status === 'pending' || status === 'queued' || status === 'started';
}

/**
 * Parse a run file's text. A text that does not parse (the file is being
 * rewritten under the read) returns `previous`, so the screen keeps what it
 * showed.
 */
export function parseWorkflowRun(text: string, previous: WorkflowRun | null = null): WorkflowRun | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return previous;
  }
  const raw = record(parsed);
  if (raw === null) return previous;

  const phases: WorkflowPhase[] = array(raw.phases).flatMap((value) => {
    const phase = record(value);
    const title = phase === null ? null : string(phase.title);
    return title === null ? [] : [{ title, detail: string(phase?.detail), agents: [] }];
  });
  const progress = array(raw.workflowProgress).map(record).filter((entry) => entry !== null);

  // Phases the script announced but `phases` did not list (a script without
  // a meta block lists none).
  for (const entry of progress) {
    if (entry.type !== 'workflow_phase') continue;
    const index = number(entry.index);
    const title = string(entry.title);
    if (index === null || title === null || index < 1) continue;
    while (phases.length < index - 1) phases.push({ title: `Phase ${phases.length + 1}`, detail: null, agents: [] });
    if (phases[index - 1] === undefined) phases[index - 1] = { title, detail: null, agents: [] };
  }

  for (const entry of progress) {
    if (entry.type !== 'workflow_agent') continue;
    const agent = agentFrom(entry);
    const phaseIndex = number(entry.phaseIndex);
    const phaseTitle = string(entry.phaseTitle);
    let phase = phaseIndex !== null && phaseIndex >= 1 ? phases[phaseIndex - 1] : undefined;
    phase ??= phases.find((candidate) => candidate.title === phaseTitle);
    if (phase === undefined) {
      // An agent outside any phase: grouped under its phase title, or under one
      // untitled group, rather than dropped.
      const title = phaseTitle ?? 'Agents';
      phase = phases.find((candidate) => candidate.title === title);
      if (phase === undefined) {
        phase = { title, detail: null, agents: [] };
        phases.push(phase);
      }
    }
    phase.agents.push(agent);
  }
  for (const phase of phases) phase.agents.sort((a, b) => a.index - b.index);

  return {
    name: string(raw.workflowName),
    summary: string(raw.summary),
    status: string(raw.status),
    phases,
    logs: array(raw.logs).flatMap((log) => (typeof log === 'string' && log.trim().length > 0 ? [log] : [])),
    durationMs: number(raw.durationMs),
    agentCount: number(raw.agentCount),
    totalTokens: number(raw.totalTokens),
  };
}

/**
 * A run still going, from its journal (`subagents/workflows/<runId>/journal.jsonl`),
 * since Claude writes the run file only when the run ends. One JSON object a
 * line, as measured (2.1.294):
 *
 *     {"type":"launched"}
 *     {"type":"started","key":"v2:…","agentId":"a1e1…","label":"review:ux","phase":"Review"}
 *     {"type":"result","key":"v2:…","agentId":"a1e1…","result":{…}}
 *
 * Phases are titled by the `phase` the agents started under, in the order
 * they first appear; an agent with a `result` is done (failed if the entry
 * carries an `error`, a shape not yet seen). The journal carries no
 * model, duration or tokens, nor the run's name, status or totals: those
 * stay null (a null status reads as running, and a card falls back to what
 * the transcript says), until the run file replaces this. A torn last line
 * (the read landed mid-append) is skipped. Null when no agent has started.
 */
export function parseWorkflowJournal(text: string): WorkflowRun | null {
  const phases: WorkflowPhase[] = [];
  const agents = new Map<string, WorkflowAgent>();
  const ended = new Map<string, boolean>();
  let index = 0;
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = record(parsed);
    const agentId = string(entry?.agentId);
    if (entry === null || agentId === null) continue;
    if (entry.type === 'result') {
      ended.set(agentId, entry.error !== undefined && entry.error !== null);
      continue;
    }
    if (entry.type !== 'started' || agents.has(agentId)) continue;
    const title = string(entry.phase) ?? 'Agents';
    let phase = phases.find((candidate) => candidate.title === title);
    if (phase === undefined) {
      phase = { title, detail: null, agents: [] };
      phases.push(phase);
    }
    index += 1;
    const agent: WorkflowAgent = {
      index, label: string(entry.label) ?? 'Agent', agentId, model: null, state: 'running',
      startedAt: null, durationMs: null, tokens: null, toolCalls: null, lastTool: null, resultPreview: null, error: null,
    };
    agents.set(agentId, agent);
    phase.agents.push(agent);
  }
  if (agents.size === 0) return null;
  for (const [agentId, failed] of ended) {
    const agent = agents.get(agentId);
    if (agent !== undefined) agent.state = failed ? 'failed' : 'done';
  }
  return { name: null, summary: null, status: null, phases, logs: [], durationMs: null, agentCount: agents.size, totalTokens: null };
}

/** The run id in a `Workflow` call's result: `Run ID: wf_31a24808-cdf`. */
export function runIdFromResult(result: string | null): string | null {
  if (result === null) return null;
  const match = /\bRun ID: (wf_[A-Za-z0-9_-]+)/.exec(result);
  return match?.[1] ?? null;
}

/** A workflow agent's state, from the four Claude writes. An unknown one is still running. */
export function agentState(state: string | null): WorkflowAgentState {
  if (state === 'done' || state === 'completed' || state === 'cached') return 'done';
  if (state === 'error' || state === 'failed' || state === 'killed') return 'failed';
  return 'running';
}

// MARK: - Internals

function agentFrom(entry: Record<string, unknown>): WorkflowAgent {
  const toolName = string(entry.lastToolName);
  const toolSummary = string(entry.lastToolSummary);
  const error = entry.error;
  return {
    index: number(entry.index) ?? 0,
    label: string(entry.label) ?? 'Agent',
    agentId: string(entry.agentId),
    model: string(entry.model),
    state: agentState(string(entry.state)),
    startedAt: number(entry.startedAt),
    durationMs: number(entry.durationMs),
    tokens: number(entry.tokens),
    toolCalls: number(entry.toolCalls),
    lastTool: toolName === null ? null : toolSummary === null ? toolName : `${toolName}: ${toolSummary}`,
    resultPreview: string(entry.resultPreview),
    error: typeof error === 'string' ? error : string(record(error)?.message),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
