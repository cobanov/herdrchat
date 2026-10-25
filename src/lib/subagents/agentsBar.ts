/**
 * What the agents bar above the composer says about Claude Code's agents
 * pane (`src/lib/transcript/agentsPane.ts`): its one-line summary, each
 * row's live elapsed time, its kind's label, and the subagent card a row
 * belongs to, when the thread has one.
 */

import { formatDuration } from './format';
import { subagentInput, type Delegation, type PlacedItem, type ToolCall } from '../threadItems';
import type { AgentRow, AgentsPane } from '../transcript/agentsPane';

/**
 * How long a row has run now: what the screen said, plus the time since it
 * was read, so the bar ticks between polls. A finished row stopped its clock.
 */
export function liveElapsed(row: AgentRow, readAt: number, now: number): number {
  return row.state === 'running' ? row.elapsedMs + Math.max(0, now - readAt) : row.elapsedMs;
}

/**
 * "2 agents working · 1h 13m", "1 agent working · 9m 49s", "5 agents done".
 *
 * Counts the rows on screen, not the pane's `↓ N more`: that count is of the
 * pane's rows below its fold, which on a real host held more than the agents
 * still running ("6 background agents" over five rows and "3 more"). The
 * expanded bar says how many more the terminal has. The time is the longest
 * a working agent has run.
 */
export function agentsSummary(pane: AgentsPane, readAt: number, now: number): string {
  const running = pane.rows.filter((row) => row.state === 'running');
  if (running.length === 0) return `${pane.rows.length} ${agents(pane.rows.length)} done`;
  const longest = Math.max(...running.map((row) => liveElapsed(row, readAt, now)));
  const time = formatDuration(longest);
  const head = `${running.length} ${agents(running.length)} working`;
  return time === null ? head : `${head} · ${time}`;
}

function agents(count: number): string {
  return count === 1 ? 'agent' : 'agents';
}

/** `fork` → "Fork", `general-purpose` → "General"; a custom agent as it is named. */
export function agentKindLabel(kind: string): string {
  if (kind === 'fork') return 'Fork';
  if (kind === 'general-purpose') return 'General';
  return kind;
}

/**
 * The subagent card in the thread a row is about: the delegation whose
 * description is the row's task, exactly, after trimming. The most recent
 * when two share it, as the pane shows the agents running now. Workflow
 * cards are not matched: their agents are not the pane's rows.
 */
export function matchingDelegation(
  items: readonly PlacedItem[],
  task: string
): { call: ToolCall; delegation: Delegation } | null {
  const wanted = task.trim();
  if (wanted.length === 0) return null;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]?.item;
    if (item?.kind !== 'subagent') continue;
    if (subagentInput(item.call).description?.trim() === wanted) return { call: item.call, delegation: item.delegation };
  }
  return null;
}
