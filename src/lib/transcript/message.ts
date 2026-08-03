/**
 * A single WhatsApp-style bubble derived from a Claude Code transcript turn.
 *
 * One transcript entry (a user or assistant turn) maps to one ChatMessage; the
 * turn's parts become ordered `segments` so the UI can show text while
 * collapsing thinking and tool activity.
 */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  segments: MessageSegment[];
  /** Epoch milliseconds, or null when the turn carried no timestamp. */
  timestamp: number | null;
  /**
   * Which agent produced this (e.g. "claude"). Set when a workspace thread
   * merges more than one agent, so bubbles can be labelled.
   */
  agentLabel: string | null;
  /** Sidechain = subagent chatter. Kept but flagged so the UI can hide it. */
  isSidechain: boolean;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export type MessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'toolUse'; name: string; input: string | null }
  | { kind: 'toolResult'; text: string };

/**
 * The plain text a chat bubble shows (text segments joined). Empty when the turn
 * was pure thinking or tool activity.
 */
export function displayText(message: ChatMessage): string {
  return message.segments
    .filter((segment): segment is Extract<MessageSegment, { kind: 'text' }> => segment.kind === 'text')
    .map((segment) => segment.text)
    .join('\n');
}

/** True when the turn carried no user-visible text (only thinking/tools). */
export function isToolOnly(message: ChatMessage): boolean {
  return displayText(message).trim().length === 0;
}
