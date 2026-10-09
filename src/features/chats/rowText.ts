import { agentName, type AgentStatus } from '@/lib/herdr/models';
import { paneChats } from './chatGroups';
import type { ChatSummary } from './useWorkspaces';

/**
 * The words on a chat row, apart from the row. Pure, so the rules for naming
 * a workspace's agents and their shared folder are pinned by tests rather
 * than only by whichever fixture a render test happens to use.
 */

/** What a row says about an agent, or a workspace, that has no message to show. */
export function statusLabel(status: AgentStatus): string {
  switch (status) {
    case 'blocked': return 'Waiting for you';
    case 'working': return 'Working';
    case 'unknown': return 'Status unknown';
    case 'done': return 'Done';
    default: return 'Idle';
  }
}

/**
 * The line under a workspace's title: which agent, in which folder.
 *
 * With several agents it names them together and the folder they share,
 * because the rows under it name each one. Naming the one the old election
 * picked made a two-agent workspace look like a one-agent one.
 */
export function rowContext(summary: ChatSummary): string {
  const panes = paneChats(summary);
  if (panes.length === 0) {
    const agent = summary.agents.find((item) => item.focused && item.agent !== null)
      ?? summary.agents.find((item) => item.agent !== null);
    const folder = agent?.cwd.split('/').filter(Boolean).slice(-2).join('/') ?? '';
    return [agentName(agent?.agent ?? null), folder].filter(Boolean).join(' · ');
  }
  const names = [...new Set(panes.map((pane) => agentName(pane.agent.agent)))];
  const shared = sharedFolder(panes.map((pane) => pane.agent.cwd)).split('/').filter(Boolean).slice(-2).join('/');
  return [`${panes.length} agents`, names.join(', '), shared].filter(Boolean).join(' · ');
}

/** The deepest folder every path is in, without its leading slash: `a/b` for `/a/b` and `/a/b/c`. */
export function sharedFolder(paths: readonly string[]): string {
  const split = paths.map((path) => path.split('/').filter(Boolean));
  const first = split[0] ?? [];
  let depth = 0;
  while (depth < first.length && split.every((parts) => parts[depth] === first[depth])) depth += 1;
  return first.slice(0, depth).join('/');
}
