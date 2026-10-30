import { chatTitle, sameName } from '@/lib/chatTitle';
import { agentName, type AgentStatus, type Pane } from '@/lib/herdr/models';
import { processLabel } from '@/lib/terminal/rows';
import { paneChats } from './chatGroups';
import type { HostRef } from './listedChat';
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
    // One agent's row of a workspace running several (`agentRows`) is titled
    // by that agent's session: the workspace's name is the line below it.
    folders: 'pane' in summary && summary.pane !== null ? undefined : workspaceFolders(summary),
  });
}

/** Every folder the workspace's panes are in, which herdr would have named it after. */
export function workspaceFolders(summary: Pick<ChatSummary, 'agents' | 'shellPanes'>): string[] {
  return [...summary.agents.map((agent) => agent.cwd), ...summary.shellPanes.map((shell) => shell.pane.cwd)];
}

/**
 * A space card's title (`spaceCardMode`): the workspace's label, after its
 * host's name when it is on another host (`klaw · kenneth-bot`), since the card stands
 * for the workspace and the line under it is its stats.
 */
export function spaceTitle(summary: ChatSummary & { host?: HostRef | null }): string {
  const label = chatTitle({ sessionTitle: null, agentName: null, workspaceLabel: summary.title, workspaceId: summary.workspaceId });
  return [summary.host?.label ?? '', label].filter(Boolean).join(' · ');
}

/**
 * The line under a space card's title: its agents by state, its tabs and
 * panes, and the folder they share, each only when it says something.
 * `2 agents, 1 needs you · 2 tabs · 4 panes · demo/api`; `1 agent working ·
 * 1 tab · 2 panes · side/herdrchat`; `no agent · 1 tab · 1 pane · demo/logs`.
 *
 * The counts are herdr's own (`tab_count`, `pane_count`), shells included;
 * from a herdr that sends none, what the snapshot listed. An agent the app
 * cannot read is a terminal row, and still one of the agents: a space holding
 * only OpenCode said "no agent" above its OpenCode row (HC-135).
 */
export function spaceStats(summary: Pick<ChatSummary, 'panes' | 'shellPanes' | 'tabs' | 'layouts' | 'tabCount' | 'paneCount'>): string {
  const statuses = [
    ...summary.panes.map((pane) => pane.status),
    ...summary.shellPanes.filter((shell) => shell.pane.agent !== null).map((shell) => shell.pane.agentStatus),
  ];
  const agents = statuses.length;
  const waiting = statuses.filter((status) => status === 'blocked').length;
  const working = statuses.filter((status) => status === 'working').length;
  const states = [
    waiting > 0 ? `${waiting} ${waiting === 1 ? 'needs' : 'need'} you` : '',
    working > 0 ? `${working} working` : '',
  ].filter(Boolean);
  const who = agents === 0 ? 'no agent'
    : agents === 1 ? `1 agent${waiting > 0 ? ' needs you' : working > 0 ? ' working' : ''}`
      : [`${agents} agents`, ...states].join(', ');
  const tabs = summary.tabCount > 0 ? summary.tabCount : Math.max(summary.tabs.length, summary.layouts.length);
  const panes = summary.paneCount > 0 ? summary.paneCount : summary.panes.length + summary.shellPanes.length;
  const folder = sharedFolder([
    ...summary.panes.map((pane) => pane.agent.cwd),
    ...summary.shellPanes.map((shell) => shell.pane.cwd),
  ]).split('/').filter(Boolean).slice(-2).join('/');
  return [
    who,
    tabs > 0 ? `${tabs} ${tabs === 1 ? 'tab' : 'tabs'}` : '',
    panes > 0 ? `${panes} ${panes === 1 ? 'pane' : 'panes'}` : '',
    folder,
  ].filter(Boolean).join(' · ');
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
 * A chat on another host says which host first, before anything about the
 * workspace: `klaw · kenneth-bot · Claude · demo/bot`. The list mixes every
 * host's chats, and the same folder on two computers is two different chats.
 */
export function rowContext(summary: ChatSummary & { host?: HostRef | null; ordinal?: string | null }): string {
  const host = summary.host?.label ?? '';
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
    const workspace = !sameName(rowTitle(summary), summary.title) && !parts.some((part) => sameName(summary.title, part)) ? summary.title.trim() : '';
    return [host, workspace, summary.ordinal ?? '', agentName(agent?.agent ?? null), folder].filter(Boolean).join(' · ');
  }
  const names = [...new Set(panes.map((pane) => agentName(pane.agent.agent)))];
  const shared = sharedFolder(panes.map((pane) => pane.agent.cwd)).split('/').filter(Boolean).slice(-2).join('/');
  return [host, `${panes.length} agents`, names.join(', '), shared].filter(Boolean).join(' · ');
}

/**
 * The line under an agent's row in the Agents view, where no workspace card
 * sits above it to say where the agent lives: the host, the workspace, then
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
export function agentContext(row: ChatSummary & { host?: HostRef | null; ordinal?: string | null }): string {
  return rowContext(row);
}

/**
 * The line under one agent's title in a workspace that holds several: its
 * provider and folder. The workspace's card above already names the
 * workspace, and its host when it is another; said again on every agent's
 * row, the host pushed the folder, the one thing telling the agents
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
 * started. The card above names the workspace and the host.
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
