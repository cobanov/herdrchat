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

/** What a `<task-notification>` says about the background task a tool call started. */
export interface TaskNotice {
  /** The call that started the task, or that last resumed it (a `SendMessage`). */
  toolUseId: string;
  /** The task: for an agent, its agent id. */
  taskId: string | null;
  /** `completed`, `failed`, `killed`, as Claude writes it. */
  status: string;
  summary: string | null;
  /** What the task handed back, when the notification carries it. */
  result: string | null;
  tokens: number | null;
  toolUses: number | null;
  durationMs: number | null;
}

export type MessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  /** `id` pairs a call with its result; absent on Codex and on older cached rows. */
  | { kind: 'toolUse'; name: string; input: string | null; id?: string }
  | { kind: 'toolResult'; text: string; toolUseId?: string; isError?: boolean }
  /**
   * A background task's end, which Claude reports as a `<task-notification>`
   * long after the call's own result: a background subagent's or a workflow's
   * result is only "launched". Never a bubble; the thread uses it to finish
   * the card of the call it names.
   */
  | { kind: 'taskNotice'; notice: TaskNotice }
  /**
   * A background subagent's report, handed back as a message from the agent
   * (`<agent-message from="<agentId>">[Subagent hand-back] …`). Claude Code
   * 2.1.294 no longer repeats it in the task notification, whose result only
   * points here. Never a bubble; the card of the agent it names shows it.
   */
  | { kind: 'handback'; agentId: string; report: string }
  /**
   * A picture sent with the message. `path` is where it lives on the host, or
   * empty when the transcript holds the picture but not where it came from
   * (one pasted straight into the agent's terminal).
   */
  | { kind: 'image'; path: string };

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

/** True when the turn carried nothing to show but machinery: no text, no picture. */
export function isToolOnly(message: ChatMessage): boolean {
  return displayText(message).trim().length === 0 && !message.segments.some((segment) => segment.kind === 'image');
}

/** The host paths of the pictures a message carries, in order; unknown ones skipped. */
export function imagePaths(message: ChatMessage): string[] {
  return message.segments.flatMap((segment) => (segment.kind === 'image' && segment.path.length > 0 ? [segment.path] : []));
}

/**
 * What a sent message and its transcript line must share to be the same
 * message: the text, and how many pictures came with it. Text alone matched a
 * picture-only message to any other line with no text, a tool result included.
 */
export function receiptKey(message: ChatMessage): string {
  const pictures = message.segments.filter((segment) => segment.kind === 'image').length;
  return `${displayText(message).trim()}\u0000${pictures}`;
}
