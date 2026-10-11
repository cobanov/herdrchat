import type { ChatListItem } from '@/features/chats/chatGroups';
import { terminalContext } from '@/features/chats/rowText';
import type { ChatSummary } from '@/features/chats/useWorkspaces';
import type { TerminalRouteParams } from '@/features/terminal/navigation';
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
 * None where no terminal can open (`terminalAvailable` false, Android): every
 * row would lead to a screen saying so.
 */
export function withTerminalRows<S extends ChatSummary>(
  rows: readonly ChatListItem<S>[],
  terminalAvailable: boolean
): ListItemWithTerminals<S>[] {
  if (!terminalAvailable) return [...rows];
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
      ...summary.shellPanes.map((terminal): Member => ({ kind: 'terminal', summary, terminal, first: false, last: false })),
    ];
    const groups = groupByTab(members, (row) => (row.kind === 'pane' ? row.pane.agent.tabId : row.terminal.pane.tabId), summary.tabs);
    const ordered = groups.length > 1 ? groups.flatMap((group) => group.rows) : members;
    const tabStarts = new Map(groups.length > 1 ? groups.map((group, index) => [group.rows[0], { group, first: index === 0 }] as const) : []);
    ordered.forEach((row, index) => {
      const start = tabStarts.get(row);
      // The first tab under the card has no line above it, so without a
      // label it has nothing to draw.
      if (start !== undefined && !(start.first && start.group.heading === null)) {
        out.push({ kind: 'tab', summary, tabId: start.group.tabId, label: start.group.heading, first: start.first });
      }
      out.push({ ...row, first: index === 0, last: index === ordered.length - 1 });
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
