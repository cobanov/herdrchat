import { useEffect, useMemo } from 'react';

import { chatItems, type HeadsUpItem } from '@/lib/headsup/items';
import type { AgentInfo } from '@/lib/herdr/models';
import type { HerdrTransport } from '@/lib/herdr/transport';
import { checkHeadsUp, useHeadsUp } from '@/state/headsUp';

/**
 * A chat's own Heads Up items: the open questions and follow-ups its Claude
 * sessions logged, the most urgent first, and those sessions' ids. Reads the
 * list once as the chat opens (the chat list's poll is paused under it), and
 * on a host without the mod finds nothing and shows nothing.
 */
export function useChatHeadsUp(
  connectionId: string | null,
  transport: HerdrTransport | null,
  agents: readonly AgentInfo[]
): { items: HeadsUpItem[]; sessionIds: string[] } {
  const file = useHeadsUp((state) => (connectionId === null ? null : state.byConnection[connectionId]?.file ?? null));
  // A string, so the poll's new agents array with the same sessions changes nothing.
  const sessionKey = agents
    .filter((agent) => agent.agent === 'claude')
    .map((agent) => agent.agentSession?.value ?? '')
    .filter((id) => id !== '')
    .join('\n');

  // Not state: the store is outside this component, and the check never rejects.
  useEffect(() => {
    if (connectionId === null || transport === null) return;
    void checkHeadsUp(connectionId, transport);
  }, [connectionId, transport]);

  return useMemo(() => {
    const sessionIds = sessionKey === '' ? [] : sessionKey.split('\n');
    return { items: file === null ? [] : chatItems(file.items, sessionIds), sessionIds };
  }, [file, sessionKey]);
}
