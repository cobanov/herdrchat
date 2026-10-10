import { chatTitle, sameName, titledBySession } from '@/lib/chatTitle';
import { agentName, type AgentStatus, type Pane } from '@/lib/herdr/models';
import { processLabel } from '@/lib/terminal/rows';
import { paneChats } from './chatGroups';
import type { MachineRef } from './listedChat';
import type { ChatSummary, PaneSummary } from './useWorkspaces';

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
 * A workspace row's title: its session's, as `chatTitle` ranks them. A
 * workspace running several agents keeps its label, since its row stands for
 * all of them and each agent's own row carries that agent's title.
 */
export function rowTitle(summary: ChatSummary): string {
  const multi = paneChats(summary).length > 0;
  return chatTitle({
    sessionTitle: multi ? null : summary.sessionTitle,
    agentName: multi ? null : summary.agentName,
    workspaceLabel: summary.title,
    workspaceId: summary.workspaceId,
  });
}

/** One agent's row title, and its thread's: that agent's session, as `chatTitle` ranks them. */
export function paneTitle(summary: ChatSummary, pane: PaneSummary): string {
  return chatTitle({
    sessionTitle: pane.sessionTitle,
    agentName: pane.agentName,
    workspaceLabel: summary.title,
    workspaceId: summary.workspaceId,
  });
}

/**
 * The line under a workspace's title: which agent, in which folder.
 *
 * With several agents it names them together and the folder they share,
 * because the rows under it name each one. Naming the one the old election
 * picked made a two-agent workspace look like a one-agent one.
 *
 * A row titled by its session names its workspace here first, since the
 * title no longer does: `api · Claude · demo/server`. When the workspace is
 * named after its folder, the folder says it: `Claude · side/herdrchat`.
 *
 * A chat on one of the host's machines says which machine first, before
 * anything about the workspace: `klaw · kenneth-bot · Claude · demo/bot`. The
 * list mixes the host's chats with its machines', and the same folder on two
 * computers is two different chats.
 */
export function rowContext(summary: ChatSummary & { machine?: MachineRef | null; ordinal?: string | null }): string {
  const machine = summary.machine?.label ?? '';
  const panes = paneChats(summary);
  if (panes.length === 0) {
    const agent = summary.agents.find((item) => item.focused && item.agent !== null)
      ?? summary.agents.find((item) => item.agent !== null);
    const parts = agent?.cwd.split('/').filter(Boolean).slice(-2) ?? [];
    const folder = parts.join('/');
    // A label that is a folder named on the line already says it, in the
    // folder; said again in front, it pushed the folder off a phone's row.
    // Either folder shown: an agent in `api/web` of workspace `api` read
    // `api · Claude · api/web`.
    const workspace = titledBySession(summary) && !parts.some((part) => sameName(summary.title, part)) ? summary.title.trim() : '';
    return [machine, workspace, summary.ordinal ?? '', agentName(agent?.agent ?? null), folder].filter(Boolean).join(' · ');
  }
  const names = [...new Set(panes.map((pane) => agentName(pane.agent.agent)))];
  const shared = sharedFolder(panes.map((pane) => pane.agent.cwd)).split('/').filter(Boolean).slice(-2).join('/');
  return [machine, `${panes.length} agents`, names.join(', '), shared].filter(Boolean).join(' · ');
}

/**
 * The line under an agent's row in the Agents view, where no workspace card
 * sits above it to say where the agent lives: the machine, the workspace, then
 * the provider and the folder (`klaw · api · Claude · api/web`).
 *
 * The very rule `rowContext` gives a one-agent workspace, and by design: an
 * agent row is shaped as one (`agentRows`), so the row `ChatRow` draws says
 * this without being told which view it is in. The workspace is said once:
 * not when the row is titled by it, and not when it names either folder
 * shown, which the folder on the same line already says. An untitled agent of
 * several says which one it is (`AgentRow.ordinal`): `api · 2 of 2 · Claude`
 * would repeat its title, so it reads `2 of 2 · Claude · x/api`.
 */
export function agentContext(row: ChatSummary & { machine?: MachineRef | null; ordinal?: string | null }): string {
  return rowContext(row);
}

/**
 * The line under one agent's title in a workspace that holds several: its
 * provider and folder. The workspace's card above already names the
 * workspace, and its machine when it is on one; said again on every agent's
 * row, the machine pushed the folder, the one thing telling the agents
 * apart, off a phone's line.
 */
export function paneContext(pane: PaneSummary): string {
  const folder = pane.agent.cwd.split('/').filter(Boolean).slice(-2).join('/');
  return [agentName(pane.agent.agent), folder].filter(Boolean).join(' · ');
}

/**
 * The line under a terminal row's title ("Terminal"): what runs there and
 * where, `vim · api/web`. The folder is the program's own when herdr knows it
 * (`foreground_cwd`), since a shell that `cd`s moves on from where the pane
 * started. The card above names the workspace and the machine.
 */
export function terminalContext(pane: Pick<Pane, 'agent' | 'title' | 'cwd' | 'foregroundCwd'>, processName: string | null): string {
  const folder = (pane.foregroundCwd ?? pane.cwd).split('/').filter(Boolean).slice(-2).join('/');
  return [processLabel(pane, processName), folder].filter(Boolean).join(' · ');
}

/** The deepest folder every path is in, without its leading slash: `a/b` for `/a/b` and `/a/b/c`. */
export function sharedFolder(paths: readonly string[]): string {
  const split = paths.map((path) => path.split('/').filter(Boolean));
  const first = split[0] ?? [];
  let depth = 0;
  while (depth < first.length && split.every((parts) => parts[depth] === first[depth])) depth += 1;
  return first.slice(0, depth).join('/');
}
