import type { ChatListItem } from '@/features/chats/chatGroups';
import type { ChatSummary } from '@/features/chats/useWorkspaces';

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
 * For the workspaces view only. A view of agents lists agents; a shell is
 * not one, and its row would be under no card.
 */
export function withTerminalRows<S extends ChatSummary>(rows: readonly ChatListItem<S>[]): ListItemWithTerminals<S>[] {
  const out: ListItemWithTerminals<S>[] = [];
  /** The workspace card whose rows are being listed, with its terminals still to place. */
  let open: S | null = null;
  let hadPanes = false;
  const flush = () => {
    if (open === null) return;
    const summary = open;
    const terminals = summary.shellPanes;
    if (terminals.length > 0 && hadPanes) {
      const previous = out[out.length - 1];
      if (previous !== undefined && previous.kind === 'pane') out[out.length - 1] = { ...previous, last: false };
    }
    terminals.forEach((terminal, index) => {
      out.push({ kind: 'terminal', summary, terminal, first: !hadPanes && index === 0, last: index === terminals.length - 1 });
    });
    open = null;
    hadPanes = false;
  };
  for (const row of rows) {
    if (row.kind === 'pane') {
      hadPanes = true;
      out.push(row);
      continue;
    }
    flush();
    out.push(row);
    if (row.kind === 'chat') open = row.summary;
  }
  flush();
  return out;
}
