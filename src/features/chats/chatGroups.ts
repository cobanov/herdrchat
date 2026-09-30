import type { ChatSummary } from './useWorkspaces';

export const CHAT_GROUPS = [
  { id: 'pinned', title: 'Pinned' },
  { id: 'needs-you', title: 'Needs you' },
  { id: 'working', title: 'Working' },
  { id: 'idle', title: 'Idle' },
] as const;
export type ChatGroupId = (typeof CHAT_GROUPS)[number]['id'];

export type ChatListItem =
  | { kind: 'group'; id: ChatGroupId; title: string; count: number }
  | { kind: 'chat'; summary: ChatSummary };

/**
 * Pinned chats first, in the order they were pinned, then by live state,
 * keeping the host's order within each group (chats without an agent too).
 *
 * A pinned chat stays in Pinned whatever it is doing: its row already says
 * when it needs you, and a pin that jumped away the moment the agent asked
 * something would not be a pin.
 */
export function groupChats(
  summaries: readonly ChatSummary[],
  query: string,
  /** When each pinned chat was pinned, by workspace id. */
  pinned: ReadonlyMap<string, number> = new Map()
): ChatListItem[] {
  const needle = query.trim().toLowerCase();
  const matches = summaries.filter((chat) =>
    [chat.title, chat.workspaceId, ...chat.agents.map((agent) => `${agent.agent ?? ''} ${agent.cwd}`)]
      .some((text) => text.toLowerCase().includes(needle))
  );
  const groupOf = (chat: ChatSummary): ChatGroupId =>
    pinned.has(chat.workspaceId)
      ? 'pinned'
      : chat.status === 'blocked' ? 'needs-you' : chat.status === 'working' ? 'working' : 'idle';
  return CHAT_GROUPS.flatMap(({ id, title }): ChatListItem[] => {
    const chats = matches.filter((chat) => groupOf(chat) === id);
    if (id === 'pinned') chats.sort((a, b) => (pinned.get(a.workspaceId) ?? 0) - (pinned.get(b.workspaceId) ?? 0));
    if (chats.length === 0) return [];
    return [
      { kind: 'group', id, title, count: chats.length },
      ...chats.map((summary): ChatListItem => ({ kind: 'chat', summary })),
    ];
  });
}
