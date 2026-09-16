import type { ChatSummary } from './useWorkspaces';

export const CHAT_GROUPS = [
  { id: 'needs-you', title: 'Needs you' },
  { id: 'working', title: 'Working' },
  { id: 'idle', title: 'Idle' },
] as const;
export type ChatGroupId = (typeof CHAT_GROUPS)[number]['id'];

export type ChatListItem =
  | { kind: 'group'; id: ChatGroupId; title: string; count: number }
  | { kind: 'chat'; summary: ChatSummary };

/** Keep the host's order within each group, including chats without an agent. */
export function groupChats(summaries: readonly ChatSummary[], query: string): ChatListItem[] {
  const needle = query.trim().toLowerCase();
  const matches = summaries.filter((chat) =>
    [chat.title, chat.workspaceId, ...chat.agents.map((agent) => `${agent.agent ?? ''} ${agent.cwd}`)]
      .some((text) => text.toLowerCase().includes(needle))
  );
  return CHAT_GROUPS.flatMap(({ id, title }): ChatListItem[] => {
    const chats = matches.filter((chat) =>
      (chat.status === 'blocked' ? 'needs-you' : chat.status === 'working' ? 'working' : 'idle') === id
    );
    if (chats.length === 0) return [];
    return [
      { kind: 'group', id, title, count: chats.length },
      ...chats.map((summary): ChatListItem => ({ kind: 'chat', summary })),
    ];
  });
}
