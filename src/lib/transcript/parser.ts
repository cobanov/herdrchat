import type { ChatMessage, MessageRole, MessageSegment } from './message';
import { codexEntry } from './codex';
import { claudeUserText, isClaudeHarnessLine } from './harness';
import type { SessionMeta } from './sessionMeta';

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
  meta: SessionMeta | null;
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
  if (isCodex(raw)) return codexEntry(raw, fallbackId(line), agentLabel);
  return { message: messageFrom(raw, line, agentLabel), meta: metaFrom(raw) };
}

/**
 * Parse a single JSONL line. Returns null for non-conversational entries (mode,
 * permission-mode, hook system output, snapshots, most attachments), for user
 * turns the harness wrote rather than the user (see `harness.ts`), and for
 * turns that carry no segments. And for anything unparseable, since a
 * transcript being tailed can hand us a truncated line at any moment.
 */
export function parseTranscriptLine(
  line: string,
  agentLabel: string | null = null
): ChatMessage | null {
  return parseTranscriptEntry(line, agentLabel).message;
}

/**
 * Model and context size for a single assistant line, for the chat header.
 *
 * `contextTokens` is the size of the request's prompt (new input plus both cache
 * tiers) — i.e. how full the context window is right now. Null for non-assistant
 * lines or lines without usage.
 */
export function assistantMeta(line: string): SessionMeta | null {
  const raw = parseJson(line);
  if (raw === null) return null;
  return isCodex(raw) ? codexEntry(raw, '', null).meta : metaFrom(raw);
}

function isCodex(raw: Record<string, unknown>): boolean {
  return raw.type === 'response_item' || raw.type === 'event_msg' || raw.type === 'turn_context';
}

/**
 * The project folder Claude Code files a cwd's transcripts under, e.g.
 * `/Users/x/Documents/obsidian/07_homelab` → `-Users-x-Documents-obsidian-07-homelab`.
 *
 * A port of Claude Code's own function (2.1.280), not an approximation of it:
 *
 *     k  = e => e.replace(/[^a-zA-Z0-9]/g, "-")
 *     kT = e => { n = k(e); return n.length <= 200 ? n
 *                   : `${n.slice(0, 200)}-${Math.abs(hash(e)).toString(36)}` }
 *
 * Two details the earlier approximation missed, and each left a thread waiting
 * forever on a file under a different name (#89):
 * - the replace works on UTF-16 units, so an emoji (two units) is two hyphens;
 * - past 200 characters the name is cut and a hash of the whole path appended.
 *
 * The output stays within `[A-Za-z0-9-]`, which keeps it shell-safe when
 * interpolated, so callers may skip quoting it.
 */
export function projectDirName(cwd: string): string {
  const name = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  if (name.length <= PROJECT_DIR_MAX) return name;
  return `${name.slice(0, PROJECT_DIR_MAX)}-${Math.abs(claudeHash(cwd)).toString(36)}`;
}

/** Where Claude Code starts cutting a project folder name. */
const PROJECT_DIR_MAX = 200;

/** Claude Code's string hash: Java's `hashCode` over UTF-16 units, in 32 bits. */
function claudeHash(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return hash;
}

// MARK: - Internals

const EMPTY_ENTRY: TranscriptEntry = { message: null, meta: null };

/** The model id Claude writes on API-error and rate-limit lines. */
const SYNTHETIC_MODEL = '<synthetic>';

/** How much of a tool's input the chip may carry. A chip shows one line anyway. */
const TOOL_INPUT_PREVIEW_CHARS = 2_000;

function messageFrom(
  raw: Record<string, unknown>,
  line: string,
  agentLabel: string | null
): ChatMessage | null {
  if (raw.type === 'attachment') return queuedPrompt(raw, line, agentLabel);
  const role = roleOf(raw.type);
  if (role === null) return null;
  if (role === 'user' && isClaudeHarnessLine(raw)) return null;

  const message = asRecord(raw.message);
  const segments = segmentsFrom(message?.content, role);
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

/**
 * A prompt that arrived while Claude was busy. Claude records it only as an
 * attachment, never as a `user` line (60 of 60 in the sample had no user line),
 * so without this a message sent from the phone mid-turn never showed up and
 * its echo could never be matched (#77). `commandMode: "task-notification"`
 * attachments are the harness's own and stay hidden.
 */
function queuedPrompt(
  raw: Record<string, unknown>,
  line: string,
  agentLabel: string | null
): ChatMessage | null {
  const attachment = asRecord(raw.attachment);
  if (attachment?.type !== 'queued_command' || attachment.commandMode !== 'prompt') return null;
  const segments = segmentsFrom(attachment.prompt, 'user');
  if (segments.length === 0) return null;
  return {
    id: typeof raw.uuid === 'string' ? raw.uuid : fallbackId(line),
    role: 'user',
    segments,
    timestamp: parseTimestamp(raw.timestamp ?? attachment.timestamp),
    agentLabel,
    isSidechain: raw.isSidechain === true,
  };
}

function metaFrom(raw: Record<string, unknown>): SessionMeta | null {
  if (raw.type !== 'assistant') return null;
  const message = asRecord(raw.message);
  if (message === null) return null;
  // Claude writes API errors, rate limits and "Login expired" as assistant
  // lines with model "<synthetic>" and all-zero usage. They are not the
  // session's model or context, and read as such they put "<synthetic>" and
  // "ctx 0" in the header (#80). The line itself still renders as a bubble.
  if (message.model === SYNTHETIC_MODEL || raw.isApiErrorMessage === true) return null;

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
 * (assistant turns, tool results). A user turn's text goes through
 * `claudeUserText`, which unwraps pastes, turns slash and shell commands back
 * into what was typed, and drops harness elements.
 */
function segmentsFrom(content: unknown, role: MessageRole): MessageSegment[] {
  if (typeof content === 'string') {
    const text = role === 'user' ? claudeUserText(content) : content;
    return text === null || text.trim().length === 0 ? [] : [{ kind: 'text', text }];
  }
  if (!Array.isArray(content)) return [];
  const segments: MessageSegment[] = [];
  for (const block of content) {
    const segment = segmentFrom(block, role);
    if (segment !== null) segments.push(segment);
  }
  return segments;
}

function segmentFrom(block: unknown, role: MessageRole): MessageSegment | null {
  const value = asRecord(block);
  if (value === null) return null;

  switch (value.type) {
    case 'text': {
      const raw = typeof value.text === 'string' ? value.text : '';
      const text = role === 'user' ? claudeUserText(raw) : raw;
      return text === null || text.length === 0 ? null : { kind: 'text', text };
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
