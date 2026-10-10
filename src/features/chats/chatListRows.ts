import type { ListMode } from '@/lib/listModes';
import { withTerminalRows, type ListItemWithTerminals } from '@/features/terminal/listRows';
import { agentRowKey, agentRows } from './agentRows';
import { groupChats } from './chatGroups';
import { rowKey, type ListedChat } from './listedChat';

/**
 * The chats list's rows in either view. Both are grouped by the one function,
 * so pins, search and the attention order cannot drift apart between them.
 *
 * Spaces hangs each workspace's panes that are not chats (a shell, a build)
 * under its card, after its agents, and they open the pane's terminal.
 * Agents lists agents: a shell is not one, and its row would sit under no
 * card, though every agent row carries its workspace's `shellPanes`.
 */
export function chatListRows(
  mode: ListMode,
  summaries: readonly ListedChat[],
  query: string,
  pinnedAt: ReadonlyMap<string, number>
): ListItemWithTerminals<ListedChat>[] {
  return mode === 'agents'
    ? groupChats(agentRows(summaries), query, pinnedAt, agentRowKey)
    : withTerminalRows(groupChats(summaries, query, pinnedAt, rowKey));
}
