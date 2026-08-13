import type { ChatMessage, MessageRole, MessageSegment } from './message';

/**
 * Turns Claude Code transcript JSONL (one JSON object per line) into chat
 * bubbles. This is what gives the chat view clean messages instead of the raw
 * TUI buffer: Claude writes every turn to
 * `~/.claude/projects/<escaped-cwd>/<sessionId>.jsonl`.
 *
 * Behaviour ported from the original SwiftUI implementation (see git
 * history before the Expo rewrite).
 */

/** Parse a whole transcript file's contents. */
export function parseTranscript(contents: string, agentLabel: string | null = null): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const line of contents.split('\n')) {
    if (line.length === 0) continue;
    const message = parseTranscriptLine(line, agentLabel);
    if (message !== null) messages.push(message);
  }
  return messages;
}

/**
 * Everything one transcript line has to say: the bubble, if it is one, and the
 * header metadata, if it carries any. Either half can be null — most lines are
 * one or the other, never both.
 */
export interface TranscriptEntry {
  message: ChatMessage | null;
  meta: AssistantMeta | null;
}

export interface AssistantMeta {
  model: string | null;
  contextTokens: number | null;
}

/**
 * Parse a line ONCE and return both of the things callers want from it.
 *
 * The tail is the only reader that sees every line as it lands, so it is the
 * cheapest possible place to learn the current model and context size — the
 * alternative was re-reading the end of the file on a timer to find out
 * something that had already streamed past. Doing it in one pass matters
 * because the live tail runs this on every appended line.
 */
export function parseTranscriptEntry(
  line: string,
  agentLabel: string | null = null
): TranscriptEntry {
  const raw = parseJson(line);
  if (raw === null) return EMPTY_ENTRY;
  return { message: messageFrom(raw, line, agentLabel), meta: metaFrom(raw) };
}

/**
 * Parse a single JSONL line. Returns null for non-conversational entries (mode,
 * permission-mode, hook system output, snapshots, attachments) and for turns
 * that carry no segments — and for anything unparseable, since a transcript
 * being tailed can hand us a truncated line at any moment.
 */
export function parseTranscriptLine(
  line: string,
  agentLabel: string | null = null
): ChatMessage | null {
  const raw = parseJson(line);
  return raw === null ? null : messageFrom(raw, line, agentLabel);
}

/**
 * Model and context size for a single assistant line, for the chat header.
 *
 * `contextTokens` is the size of the request's prompt (new input plus both cache
 * tiers) — i.e. how full the context window is right now. Null for non-assistant
 * lines or lines without usage.
 */
export function assistantMeta(line: string): AssistantMeta | null {
  const raw = parseJson(line);
  return raw === null ? null : metaFrom(raw);
}

/**
 * Claude escapes a cwd into a project directory name by replacing every
 * character that is not ASCII-alphanumeric with a hyphen, e.g.
 * `/Users/x/Documents/obsidian/07_homelab` → `-Users-x-Documents-obsidian-07-homelab`
 * (verified empirically against ~/.claude/projects).
 *
 * Restricting the output to `[A-Za-z0-9-]` also keeps the name shell-safe when
 * interpolated, which is why callers may skip quoting it.
 */
export function projectDirName(cwd: string): string {
  let name = '';
  for (const char of cwd) {
    name += /[A-Za-z0-9]/.test(char) ? char : '-';
  }
  return name;
}

// MARK: - Internals

const EMPTY_ENTRY: TranscriptEntry = { message: null, meta: null };

/** How much of a tool's input the chip may carry. A chip shows one line anyway. */
const TOOL_INPUT_PREVIEW_CHARS = 2_000;

function messageFrom(
  raw: Record<string, unknown>,
  line: string,
  agentLabel: string | null
): ChatMessage | null {
  const role = roleOf(raw.type);
  if (role === null) return null;

  const message = asRecord(raw.message);
  const segments = segmentsFrom(message?.content);
  if (segments.length === 0) return null;

  return {
    id: typeof raw.uuid === 'string' ? raw.uuid : fallbackId(line),
    role,
    segments,
    timestamp: parseTimestamp(raw.timestamp),
    agentLabel,
    isSidechain: raw.isSidechain === true,
  };
}

function metaFrom(raw: Record<string, unknown>): AssistantMeta | null {
  if (raw.type !== 'assistant') return null;
  const message = asRecord(raw.message);
  if (message === null) return null;

  const usage = asRecord(message.usage);
  // Null, not 0, when the line carries no token counts at all. A `usage` block
  // with none of the three fields used to total 0, and the header merges with
  // `??`, so a real context size was overwritten by a zero the moment one such
  // line streamed in.
  const counts =
    usage === null
      ? []
      : [usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens]
          .filter((value): value is number => typeof value === 'number');
  const contextTokens =
    counts.length === 0 ? null : counts.reduce((total, value) => total + value, 0);
  const model = typeof message.model === 'string' ? message.model : null;

  if (model === null && contextTokens === null) return null;
  return { model, contextTokens };
}

function roleOf(type: unknown): MessageRole | null {
  if (type === 'user') return 'user';
  if (type === 'assistant') return 'assistant';
  return null; // system/mode/attachment/etc. are not bubbles
}

/**
 * `content` is either a plain string (user turns) or an array of typed blocks
 * (assistant turns, tool results).
 */
function segmentsFrom(content: unknown): MessageSegment[] {
  if (typeof content === 'string') {
    return content.trim().length === 0 ? [] : [{ kind: 'text', text: content }];
  }
  if (!Array.isArray(content)) return [];
  const segments: MessageSegment[] = [];
  for (const block of content) {
    const segment = segmentFrom(block);
    if (segment !== null) segments.push(segment);
  }
  return segments;
}

function segmentFrom(block: unknown): MessageSegment | null {
  const value = asRecord(block);
  if (value === null) return null;

  switch (value.type) {
    case 'text': {
      const text = typeof value.text === 'string' ? value.text : '';
      return text.length === 0 ? null : { kind: 'text', text };
    }
    case 'thinking': {
      const text = typeof value.thinking === 'string' ? value.thinking : '';
      return text.length === 0 ? null : { kind: 'thinking', text };
    }
    case 'tool_use':
      return {
        kind: 'toolUse',
        name: typeof value.name === 'string' ? value.name : 'tool',
        input: compactJson(value.input),
      };
    case 'tool_result':
      return { kind: 'toolResult', text: flattenContent(value.content) };
    default:
      return null;
  }
}

function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      const value = asRecord(block);
      return value !== null && typeof value.text === 'string' ? value.text : null;
    })
    .filter((text): text is string => text !== null)
    .join('\n');
}

/**
 * A short single-line preview of a tool's input, for the tool chip.
 *
 * Capped, because "short" was only ever true of the tools that take short
 * arguments: a Write of a 200 KB file put the whole body here, and every one of
 * those went into SQLite and back out again on each thread open.
 */
function compactJson(value: unknown): string | null {
  const flat = flattenJson(value);
  if (flat === null || flat.length <= TOOL_INPUT_PREVIEW_CHARS) return flat;
  return `${flat.slice(0, TOOL_INPUT_PREVIEW_CHARS)}…`;
}

function flattenJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => flattenJson(item) ?? 'null').join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => `${key}: ${flattenJson(item) ?? 'null'}`
    );
    return `{${entries.join(', ')}}`;
  }
  return null;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseJson(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return asRecord(parsed);
  } catch {
    return null; // truncated tail line, or not JSON at all
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * A stable id for a turn Claude wrote without a uuid. Derived from the line so
 * the same turn keeps the same id across a reload — a random id would make
 * dedupe fail and re-append history on every resume.
 */
function fallbackId(line: string): string {
  let hash = 5381;
  for (let index = 0; index < line.length; index += 1) {
    hash = ((hash * 33) ^ line.charCodeAt(index)) >>> 0;
  }
  return `line-${hash.toString(36)}`;
}
