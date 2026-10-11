import type { MachineRef } from './listedChat';
import type { ChatSummary, PaneSummary } from './useWorkspaces';

export const CHAT_GROUPS = [
  { id: 'pinned', title: 'Pinned' },
  { id: 'needs-you', title: 'Needs you' },
  { id: 'working', title: 'Working' },
  { id: 'idle', title: 'Idle' },
] as const;
export type ChatGroupId = (typeof CHAT_GROUPS)[number]['id'];

export type ChatListItem<S extends ChatSummary = ChatSummary> =
  | { kind: 'group'; id: ChatGroupId; title: string; count: number }
  | { kind: 'chat'; summary: S }
  /** One agent of a workspace whose card is a space (`spaceCardMode`), listed under it. */
  | {
    kind: 'pane'; summary: S; pane: S['panes'][number];
    /**
     * Where this row sits among the agents listed under its workspace, which
     * a search can make fewer than the workspace holds. The row's rail joins
     * the workspace card above the first and stops at the last.
     */
    first: boolean; last: boolean;
  }
  /**
   * Where a tab's rows start under a space card whose listed rows sit in two
   * or more tabs (`withTerminalRows`): a hairline between it and the tab
   * before, and the tab's label above its rows when the person named it.
   * The first tab's has no line, and is only there when it has a label.
   */
  | {
    kind: 'tab'; summary: S; tabId: string;
    /** `tabHeading`: null for a tab herdr only numbered. */
    label: string | null;
    first: boolean;
  };

/**
 * What a workspace's card in Spaces stands for.
 *
 * `chat`: the workspace holds one conversational agent and nothing else, so
 * the card is that agent's chat, titled by its session, and opens it.
 * `space`: anything more (two agents, or an agent beside a shell, or only
 * shells): the card is the workspace, titled by its label with its stats
 * under it, and it opens the workspace's layout; each agent is a row of its
 * own under it, then each other pane's terminal row. A one-agent workspace
 * with a shell used to be the agent's card with the terminal row hanging off
 * it, which read as if the terminal belonged to the agent.
 *
 * A workspace whose one agent herdr could not restore (no pane, a
 * `restoreError`, nothing else in it) is still that agent's chat: its card
 * says "Couldn't restore" and opens the conversation, as it always did. As a
 * space it would be titled by the workspace with "no agent" and open a layout
 * with nothing to tap, and the conversation could not be reached from Spaces.
 */
export type SpaceCardMode = 'chat' | 'space';

export function spaceCardMode(summary: Pick<ChatSummary, 'panes' | 'shellPanes' | 'restoreError'>): SpaceCardMode {
  if (summary.shellPanes.length > 0) return 'space';
  if (summary.panes.length === 1) return 'chat';
  return summary.panes.length === 0 && summary.restoreError !== null ? 'chat' : 'space';
}

/**
 * The agents of a workspace that get rows of their own: every one of them
 * under a space card, none under a chat card, whose one agent is the card.
 */
export function paneChats<S extends ChatSummary>(summary: S): readonly S['panes'][number][] {
  return spaceCardMode(summary) === 'space' ? summary.panes : [];
}

/**
 * Pinned chats first, in the order they were pinned, then by live state,
 * keeping the host's order within each group (chats without an agent too).
 *
 * A pinned chat stays in Pinned whatever it is doing: its row already says
 * when it needs you, and a pin that jumped away the moment the agent asked
 * something would not be a pin.
 *
 * A chat on one of the host's machines is grouped like any other, and found
 * by its machine's label too. `keyOf` names a row: the workspace id on one
 * host, `rowKey` once a list holds machines, whose workspace ids repeat the
 * host's.
 */
export function groupChats<S extends ChatSummary & { machine?: MachineRef | null }>(
  summaries: readonly S[],
  query: string,
  /** When each pinned chat was pinned, by `keyOf`. */
  pinned: ReadonlyMap<string, number> = new Map(),
  keyOf: (summary: S) => string = (summary) => summary.workspaceId
): ChatListItem<S>[] {
  const needle = query.trim().toLowerCase();
  const found = (texts: readonly string[]) => texts.some((text) => text.toLowerCase().includes(needle));
  // A chat is found by the title its row shows, the session's, as well.
  const paneMatches = (pane: PaneSummary) => found([`${pane.agent.agent ?? ''} ${pane.agent.cwd}`, pane.sessionTitle ?? '', pane.agentName ?? '']);
  /** The pane rows to list under a chat: all of them when the workspace itself matched. */
  const panesOf = new Map<string, readonly S['panes'][number][]>();
  const matches = summaries.filter((chat) => {
    const panes = paneChats(chat);
    const own = [chat.title, chat.workspaceId, chat.machine?.label ?? ''];
    if (found([...own, ...chat.agents.map((agent) => `${agent.agent ?? ''} ${agent.cwd} ${agent.title ?? ''} ${agent.name ?? ''}`)])) {
      // A folder or provider shared by only some of the agents names those.
      // A search for the workspace's own name lists every agent in it.
      // So does a search for the machine it is on.
      const named = found(own) ? [] : panes.filter(paneMatches);
      panesOf.set(keyOf(chat), named.length > 0 ? named : panes);
      return true;
    }
    return false;
  });
  const groupOf = (chat: S): ChatGroupId =>
    pinned.has(keyOf(chat))
      ? 'pinned'
      : chat.status === 'blocked' ? 'needs-you' : chat.status === 'working' ? 'working' : 'idle';
  return CHAT_GROUPS.flatMap(({ id, title }): ChatListItem<S>[] => {
    const chats = matches.filter((chat) => groupOf(chat) === id);
    if (id === 'pinned') chats.sort((a, b) => (pinned.get(keyOf(a)) ?? 0) - (pinned.get(keyOf(b)) ?? 0));
    if (chats.length === 0) return [];
    return [
      { kind: 'group', id, title, count: chats.length },
      ...chats.flatMap((summary): ChatListItem<S>[] => [
        { kind: 'chat', summary },
        ...(panesOf.get(keyOf(summary)) ?? []).map((pane, index, listed): ChatListItem<S> => ({
          kind: 'pane', summary, pane, first: index === 0, last: index === listed.length - 1,
        })),
      ]),
    ];
  });
}
