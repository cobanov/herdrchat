import { splitImages } from './images';
import type { MessageSegment } from './message';
import type { TranscriptEntry } from './parser';
import type { SessionMeta } from './sessionMeta';
import { capped, compactJson } from './toolPreview';

const NOTHING: TranscriptEntry = { message: null, meta: null };

/**
 * Maps Gemini CLI's session log to chat bubbles
 * (`~/.gemini/tmp/<project>/chats/session-<time>-<id8>.jsonl`, measured
 * against 0.64). The first line is the session's metadata; after it, one
 * message a line: the person's (`user`), the model's (`gemini`) or the CLI's
 * own (`info`, `error`, `warning`, never shown). A message is written again
 * under its id as it changes, its tool calls with their results and its
 * tokens arriving that way, and the later line wins (`parseTranscript`,
 * `ThreadWindow.append`).
 *
 * shortcut: `{$rewindTo: id}` (a rewind drops that message and the rest) and
 * `{$patch: …}` (Gemini rewriting history it compressed or rolled back) are
 * read as nothing, so a rewound turn stays on screen. Upgrade when the thread
 * can remove a message, which both need.
 */
export function geminiEntry(raw: Record<string, unknown>, agentLabel: string | null): TranscriptEntry {
  const messageId = raw.id;
  if (typeof messageId !== 'string') return NOTHING;
  const created = typeof raw.timestamp === 'string' ? Date.parse(raw.timestamp) : Number.NaN;
  const entry = (role: 'user' | 'assistant', segments: MessageSegment[], meta: SessionMeta | null = null): TranscriptEntry => ({
    message: segments.length === 0 ? null : {
      id: `gemini:${messageId}`,
      role,
      segments,
      timestamp: Number.isFinite(created) ? created : null,
      agentLabel,
      isSidechain: false,
    },
    meta,
  });

  if (raw.type === 'user') {
    // What was typed, when Gemini sent the model more (a file an @ named).
    const typed = partsText(raw.displayContent ?? raw.content);
    // Gemini's own context for the model is no one's message; nor is a
    // tool's answer, which has no text.
    if (/^<(?:session|hook)_context>/.test(typed.trim())) return NOTHING;
    const { text, paths } = splitImages(typed);
    return entry('user', [
      ...(text.length > 0 ? [{ kind: 'text' as const, text }] : []),
      ...paths.map((path) => ({ kind: 'image' as const, path })),
    ]);
  }
  if (raw.type !== 'gemini') return NOTHING;

  const thoughts = Array.isArray(raw.thoughts) ? raw.thoughts.map(record).filter((thought) => thought !== null) : [];
  const calls = Array.isArray(raw.toolCalls) ? raw.toolCalls.map(record).filter((call) => call !== null) : [];
  const text = partsText(raw.content).trim();
  const tokens = record(raw.tokens);
  // Gemini's prompt count already holds the cached part of it.
  const input = typeof tokens?.input === 'number' && Number.isFinite(tokens.input) ? tokens.input : null;
  const model = typeof raw.model === 'string' && raw.model.length > 0 ? raw.model : null;
  return entry('assistant', [
    ...thoughts.flatMap((thought) => {
      const said = [thought.subject, thought.description].filter((part) => typeof part === 'string' && part.trim().length > 0);
      return said.length === 0 ? [] : [{ kind: 'thinking' as const, text: said.join(': ') }];
    }),
    ...(text.length > 0 ? [{ kind: 'text' as const, text }] : []),
    ...calls.flatMap((call): MessageSegment[] => {
      const id = `gemini-${String(call.id)}`;
      const use: MessageSegment = {
        kind: 'toolUse',
        name: typeof call.name === 'string' ? call.name : 'tool',
        // As Claude's are, so its row reads the command or the file.
        input: compactJson(call.args),
        id,
      };
      if (!Array.isArray(call.result)) return [use];
      const failed = call.status === 'error' || call.status === 'cancelled';
      return [use, { kind: 'toolResult', text: capped(resultText(call.result)), toolUseId: id, ...(failed ? { isError: true } : {}) }];
    }),
  ], model === null && input === null ? null : { model, contextTokens: input });
}

/** True for a line of Gemini CLI's session log: a message, or a record about the session. */
export function isGeminiRecord(raw: Record<string, unknown>): boolean {
  if ('$set' in raw || '$patch' in raw || '$rewindTo' in raw) return true;
  if (typeof raw.sessionId === 'string' && typeof raw.projectHash === 'string') return true;
  // Claude's lines have a `type` of `user` too, but carry their turn in `message`.
  return typeof raw.id === 'string' && 'content' in raw && !('message' in raw) &&
    (raw.type === 'user' || raw.type === 'gemini' || raw.type === 'info' || raw.type === 'error' || raw.type === 'warning');
}

/** The text of a message's content: a string, or Gemini's parts, of which only text is said. */
function partsText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(record)
    .map((part) => (typeof part?.text === 'string' && part.thought !== true ? part.text : ''))
    .join('');
}

/**
 * What a tool returned: the output or error each of its parts gave the model,
 * out of the `<untrusted_context>` Gemini puts a command's output in.
 */
function resultText(parts: readonly unknown[]): string {
  return parts.map(record).map((part) => {
    const response = record(record(part?.functionResponse)?.response);
    const said = response?.output ?? response?.error ?? part?.text;
    return typeof said !== 'string' ? '' : said
      .replace(/^<untrusted_context>\n?([\s\S]*?)\n?<\/untrusted_context>$/, '$1')
      .replaceAll('&lt;/untrusted_context&gt;', '</untrusted_context>');
  }).filter((text) => text.length > 0).join('\n').trim();
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
