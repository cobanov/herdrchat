import { useEffect, useMemo } from 'react';

import { HEADSUP_READ_INTERVAL_MS } from '@/lib/headsup/client';
import { chatItems, type HeadsUpItem } from '@/lib/headsup/items';
import { sendTarget, type AgentInfo } from '@/lib/herdr/models';
import type { HerdrTransport } from '@/lib/herdr/transport';
import { checkHeadsUp, useHeadsUp } from '@/state/headsUp';

/**
 * The Claude session this chat's composer sends to, the only one whose
 * questions Answer can reach from here: in a workspace's chat holding several
 * agents, a reply to another agent's question would go to the wrong session.
 * `agents` is the chat's own (one pane's, for a pane's chat). Empty for none.
 */
export function chatHeadsUpSession(agents: readonly AgentInfo[]): string {
  const target = sendTarget(agents);
  return target?.agent === 'claude' ? target.agentSession?.value ?? '' : '';
}

/**
 * A chat's own Heads Up items: the open questions and follow-ups that the
 * session it sends to logged and nobody has replied to, the most urgent
 * first, and that session's id. Reads the list as the chat opens and again on
 * the list's cadence while the chat is on screen (the chat list's poll is
 * paused under it), so a question Claude resolved after an answer leaves the
 * bar. On a host without the mod it finds nothing and shows nothing.
 */
export function useChatHeadsUp(
  connectionId: string | null,
  transport: HerdrTransport | null,
  agents: readonly AgentInfo[],
  /** The thread's poll gate: on screen and in the foreground. */
  active: boolean
): { items: HeadsUpItem[]; sessionIds: string[] } {
  const file = useHeadsUp((state) => (connectionId === null ? null : state.byConnection[connectionId]?.file ?? null));
  // A string, so the poll's new agents array with the same session changes nothing.
  const sessionId = chatHeadsUpSession(agents);

  // Not state: the store is outside this component, and the check never rejects.
  useEffect(() => {
    if (connectionId === null || transport === null || !active) return;
    void checkHeadsUp(connectionId, transport);
    const timer = setInterval(() => void checkHeadsUp(connectionId, transport), HEADSUP_READ_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [connectionId, transport, active]);

  return useMemo(() => {
    const sessionIds = sessionId === '' ? [] : [sessionId];
    return { items: file === null ? [] : chatItems(file.items, sessionIds), sessionIds };
  }, [file, sessionId]);
}
