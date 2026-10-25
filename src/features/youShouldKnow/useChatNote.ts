import { useEffect } from 'react';

import { YSK_READ_INTERVAL_MS } from '@/lib/youShouldKnow/client';
import { chatNoteSession, noteOf, type Note } from '@/lib/youShouldKnow/notes';
import type { AgentInfo } from '@/lib/herdr/models';
import type { HerdrTransport } from '@/lib/herdr/transport';
import { checkYouShouldKnow, useYouShouldKnow } from '@/state/youShouldKnow';

/**
 * A chat's own note: the one "You should know" is showing for the session
 * the chat's composer sends to, or null. Reads the store as the chat opens and
 * again on the chats' cadence while the chat is on screen (the chat list's
 * poll is paused under it), so a note answered at the computer, or cleared by
 * the terminal after two prompts, leaves the bar. On a host without the plugin
 * it finds nothing and shows nothing.
 */
export function useChatNote(
  connectionId: string | null,
  transport: HerdrTransport | null,
  agents: readonly AgentInfo[],
  /** The thread's poll gate: on screen and in the foreground. */
  active: boolean
): Note | null {
  const notes = useYouShouldKnow((state) => (connectionId === null ? null : state.byConnection[connectionId]?.file?.notes ?? null));
  // A string, so the poll's new agents array with the same session changes nothing.
  const sessionId = chatNoteSession(agents);

  // Not state: the store is outside this component, and the check never rejects.
  useEffect(() => {
    if (connectionId === null || transport === null || !active) return;
    void checkYouShouldKnow(connectionId, transport);
    const timer = setInterval(() => void checkYouShouldKnow(connectionId, transport), YSK_READ_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [connectionId, transport, active]);

  return notes === null ? null : noteOf(notes, sessionId);
}
