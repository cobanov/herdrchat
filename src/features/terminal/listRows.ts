import { CHAT_GROUPS, type ChatGroupId, type ChatListItem } from '@/features/chats/chatGroups';
import { terminalContext } from '@/features/chats/rowText';
import type { ChatSummary } from '@/features/chats/useWorkspaces';
import type { TerminalRouteParams } from '@/features/terminal/navigation';
import { agentName, type AgentStatus } from '@/lib/herdr/models';
import { groupByTab } from '@/lib/spaces/tabGroups';
import { paneKind } from '@/lib/terminal/command';
import type { TerminalPane } from '@/lib/terminal/rows';

/** A pane's terminal row under its workspace's card. */
export interface TerminalListItem<S extends ChatSummary = ChatSummary> {
  kind: 'terminal';
  summary: S;
  terminal: S['shellPanes'][number];
  first: boolean;
  last: boolean;
  /** Under no card (the Agents view): no rail, no indent. */
  standalone?: boolean;
}

export type ListItemWithTerminals<S extends ChatSummary = ChatSummary> = ChatListItem<S> | TerminalListItem<S>;

/**
 * The chats' rows with each workspace's terminal rows after its agents' rows,
 * on the one rail under the card: the first of all of them reaches up to the
 * card and the last of all of them ends the rail, so an agent's row that was
 * the last is not any more once a terminal follows it.
 *
 * When those rows sit in two or more of the workspace's tabs, they are
 * listed tab by tab (`groupByTab`), each tab's agents then its terminals,
 * with a `tab` item where each tab starts: a line between tabs, and the
 * tab's label when it has one. They used to be every agent and then every
 * shell, so a dev server alone in a tab of its own read as if it sat beside
 * the agents. The rail stays the card's, from the card to its last row,
 * through the lines.
 *
 * For the workspaces view only. A view of agents lists agents; a shell is
 * not one, and its row would be under no card.
 *
 * Where no terminal can open (`terminalAvailable` false, Android) a shell has
 * no row, since every one would lead to a screen saying so; an agent the app
 * has no reader for keeps its row, or it would be in no list at all.
 */
export function withTerminalRows<S extends ChatSummary>(
  rows: readonly ChatListItem<S>[],
  terminalAvailable: boolean
): ListItemWithTerminals<S>[] {
  type Member = Extract<ChatListItem<S>, { kind: 'pane' }> | TerminalListItem<S>;
  const out: ListItemWithTerminals<S>[] = [];
  /** The workspace card whose rows are being listed, with its agents' rows so far. */
  let open: S | null = null;
  let panes: Member[] = [];
  const flush = () => {
    if (open === null) return;
    const summary = open;
    const members: Member[] = [
      ...panes,
      ...summary.shellPanes
        .filter((terminal) => terminalAvailable || terminal.pane.agent !== null)
        .map((terminal): Member => ({ kind: 'terminal', summary, terminal, first: false, last: false })),
    ];
    const groups = groupByTab(members, (row) => (row.kind === 'pane' ? row.pane.agent.tabId : row.terminal.pane.tabId), summary.tabs);
    const ordered = groups.length > 1 ? groups.flatMap((group) => group.rows) : members;
    const tabStarts = new Map(groups.length > 1 ? groups.map((group, index) => [group.rows[0], { group, first: index === 0 }] as const) : []);
    /** Whether a tab item leads: its rail reaches up to the card, so the row under it starts at its own top. */
    let tabItemFirst = false;
    ordered.forEach((row, index) => {
      const start = tabStarts.get(row);
      // The first tab under the card has no line above it, so without a
      // label it has nothing to draw.
      if (start !== undefined && !(start.first && start.group.heading === null)) {
        out.push({ kind: 'tab', summary, tabId: start.group.tabId, label: start.group.heading, first: start.first });
        if (index === 0) tabItemFirst = true;
      }
      // Under a leading tab item the row's rail starts at its own top: two
      // translucent hairlines over one gap would show as a darker step.
      out.push({ ...row, first: index === 0 && !tabItemFirst, last: index === ordered.length - 1 });
    });
    open = null;
    panes = [];
  };
  for (const row of rows) {
    if (row.kind === 'pane') {
      panes.push(row);
      continue;
    }
    flush();
    if (row.kind === 'chat') open = row.summary;
    out.push(row);
  }
  flush();
  return out;
}

/**
 * The Agents view's rows, with each agent the app has no reader for as a
 * terminal row of its own, in the group its status puts it in. Spaces lists it
 * as a terminal row under its workspace; here it was in no list at all. It
 * hangs under no card, so it is drawn standalone, and a search finds it by its
 * agent, folder, title or workspace as it finds an agent's row.
 */
export function withAgentTerminals<S extends ChatSummary>(
  rows: readonly ChatListItem<S>[],
  summaries: readonly S[],
  query: string
): ListItemWithTerminals<S>[] {
  const needle = query.trim().toLowerCase();
  const terminals = summaries.flatMap((summary) => summary.shellPanes
    .filter(({ pane }) => pane.agent !== null && (needle === '' ||
      [pane.agent, agentName(pane.agent), pane.cwd, pane.title ?? '', summary.title].some((text) => text.toLowerCase().includes(needle))))
    .map((terminal): TerminalListItem<S> => ({ kind: 'terminal', summary, terminal, first: true, last: true, standalone: true })));
  if (terminals.length === 0) return [...rows];
  const groupOf = (status: AgentStatus): ChatGroupId => (status === 'blocked' ? 'needs-you' : status === 'working' ? 'working' : 'idle');
  const sections = new Map<ChatGroupId, ChatListItem<S>[]>();
  let current: ChatGroupId | null = null;
  for (const row of rows) {
    if (row.kind === 'group') current = row.id;
    if (current !== null) sections.set(current, [...(sections.get(current) ?? []), row]);
  }
  return CHAT_GROUPS.flatMap(({ id, title }): ListItemWithTerminals<S>[] => {
    const [head, ...listed] = sections.get(id) ?? [];
    const extra = terminals.filter((row) => groupOf(row.terminal.pane.agentStatus) === id);
    if (extra.length === 0) return head === undefined ? [] : [head, ...listed];
    const count = (head?.kind === 'group' ? head.count : 0) + extra.length;
    return [{ kind: 'group', id, title, count }, ...listed, ...extra];
  });
}

/**
 * What a terminal row opens: its pane, attached by the pane's own terminal id
 * (`''` when herdr sent none, which the screen says needs a newer herdr).
 */
export function terminalRowParams(connectionId: string, terminal: TerminalPane): TerminalRouteParams {
  return {
    connectionId,
    paneId: terminal.paneId,
    kind: paneKind(terminal.pane.agent),
    terminalId: terminal.pane.terminalId ?? '',
    title: terminalContext(terminal.pane, terminal.processName),
  };
}
