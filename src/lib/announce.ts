import type { ChatMessage } from './transcript/message';

/** What VoiceOver hears about an open chat: is the agent asking, and its latest reply. */
export interface ThreadMoment {
  /** The agent's question while it waits on the person ('' when none could be read); null when it is not waiting. */
  blocked: string | null;
  /** The id of the agent's latest message with text in it. */
  lastReply: string | null;
}

/**
 * What to announce as the chat goes from `before` to `now`, or null. Nothing
 * on opening (`before` null): the screen reader reads the screen then. A
 * screen reader user otherwise hears nothing when the agent stops to ask, the
 * one moment the app exists for.
 */
export function threadAnnouncement(before: ThreadMoment | null, now: ThreadMoment, agent: string): string | null {
  if (before === null) return null;
  if (now.blocked !== null && before.blocked === null) {
    return now.blocked === '' ? `${agent} needs you.` : `${agent} needs you: ${now.blocked}`;
  }
  if (now.lastReply !== null && now.lastReply !== before.lastReply) return `${agent} replied.`;
  return null;
}

/** The id of the latest assistant message that says something (not only thinking or a tool call). */
export function lastReplyId(messages: readonly ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === 'assistant' && !message.isSidechain
      && message.segments.some((segment) => segment.kind === 'text')) return message.id;
  }
  return null;
}
