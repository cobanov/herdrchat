import { splitImages } from './images';
import type { ChatMessage, MessageSegment } from './message';
import type { TranscriptEntry } from './parser';
import type { SessionMeta } from './sessionMeta';

/**
 * Maps OMP's append-only JSONL journal to chat bubbles. This deliberately reads
 * records in file order: OMP's parent links describe a branch tree, but the
 * transcript reader does not reconstruct that tree.
 */
export function ompEntry(
  raw: Record<string, unknown>,
  fallbackId: string,
  agentLabel: string | null
): TranscriptEntry {
  switch (raw.type) {
    case 'message':
      return messageEntry(raw, fallbackId, agentLabel);
    case 'model_change':
      return {
        message: null,
        meta: typeof raw.model === 'string' && raw.model.length > 0
          ? { model: raw.model, contextTokens: null }
          : null,
      };
    case 'thinking_level_change':
      return {
        message: null,
        meta: {
          model: null,
          effort: typeof raw.thinkingLevel === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(raw.thinkingLevel)
            ? raw.thinkingLevel
            : null,
          contextTokens: null,
        },
      };
    case 'branch_summary':
      return typeof raw.summary === 'string' ? boundaryEntry(raw, fallbackId, agentLabel, 'Branch summary') : EMPTY_ENTRY;
    case 'reset_boundary':
      return boundaryEntry(raw, fallbackId, agentLabel, 'Context reset');
    default:
      // Session headers, custom extension state, labels, and all other
      // non-message journal records are not conversation bubbles.
      return EMPTY_ENTRY;
  }
}

const EMPTY_ENTRY: TranscriptEntry = { message: null, meta: null };

function messageEntry(
  raw: Record<string, unknown>,
  fallbackId: string,
  agentLabel: string | null
): TranscriptEntry {
  const message = record(raw.message);
  if (message === null) return EMPTY_ENTRY;

  const parsed = messageFrom(message);
  if (parsed === null) return { message: null, meta: assistantMeta(message) };

  return {
    message: {
      ...parsed,
      id: `omp:${entryId(raw, fallbackId)}`,
      timestamp: messageTimestamp(message, raw),
      agentLabel,
      isSidechain: false,
    },
    meta: assistantMeta(message),
  };
}

function messageFrom(message: Record<string, unknown>): Pick<ChatMessage, 'role' | 'segments'> | null {
  switch (message.role) {
    case 'user': {
      const segments = userSegments(message.content);
      return segments.length === 0 ? null : { role: 'user', segments };
    }
    case 'assistant': {
      const segments = assistantSegments(message.content);
      return segments.length === 0 ? null : { role: 'assistant', segments };
    }
    case 'toolResult':
      // OMP's result names its call and says outright whether it failed.
      return { role: 'user', segments: [{
        kind: 'toolResult',
        text: toolResultText(message.content),
        ...(typeof message.toolCallId === 'string' ? { toolUseId: message.toolCallId } : {}),
        ...(message.isError === true ? { isError: true } : {}),
      }] };
    default:
      return null;
  }
}

/** OMP user input is already the persisted input; do not apply Claude harness cleanup. */
function userSegments(content: unknown): MessageSegment[] {
  const textBlocks = typeof content === 'string'
    ? [content]
    : Array.isArray(content)
      ? content.flatMap(block => {
        const value = record(block);
        return value?.type === 'text' && typeof value.text === 'string' ? [value.text] : [];
      })
      : [];
  const { text, paths } = splitImages(textBlocks.join('\n'));
  const imageBlocks = Array.isArray(content)
    ? content.filter(block => record(block)?.type === 'image').length
    : 0;
  const segments: MessageSegment[] = text.length === 0 ? [] : [{ kind: 'text', text }];
  for (const path of paths) segments.push({ kind: 'image', path });
  for (let index = paths.length; index < imageBlocks; index += 1) segments.push({ kind: 'image', path: '' });
  return segments;
}

function assistantSegments(content: unknown): MessageSegment[] {
  if (!Array.isArray(content)) return [];
  const segments: MessageSegment[] = [];
  for (const block of content) {
    const value = record(block);
    if (value === null) continue;
    switch (value.type) {
      case 'text':
        if (typeof value.text === 'string' && value.text.length > 0) segments.push({ kind: 'text', text: value.text });
        break;
      case 'thinking':
        if (typeof value.thinking === 'string' && value.thinking.length > 0) {
          segments.push({ kind: 'thinking', text: value.thinking });
        }
        break;
      case 'toolCall':
        segments.push({
          kind: 'toolUse',
          name: typeof value.name === 'string' ? value.name : 'tool',
          input: preview(value.arguments),
          ...(typeof value.id === 'string' ? { id: value.id } : {}),
        });
        break;
      case 'image':
        // Inline data and blob references do not name a host file. Keep the
        // factual image marker without pretending either is a readable path.
        segments.push({ kind: 'image', path: '' });
        break;
      default:
        break;
    }
  }
  return segments;
}

/** Tool output is machinery, never receipt text for a sent user message. */
function toolResultText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content.flatMap(block => {
    const value = record(block);
    return value?.type === 'text' && typeof value.text === 'string' ? [value.text] : [];
  }).join('\n');
}

function assistantMeta(message: Record<string, unknown>): SessionMeta | null {
  if (message.role !== 'assistant') return null;
  const model = typeof message.model === 'string' && message.model.length > 0 ? message.model : null;
  const contextTokens = contextTokensFrom(message);
  return model === null && contextTokens === null ? null : { model, contextTokens };
}

function contextTokensFrom(message: Record<string, unknown>): number | null {
  const snapshot = record(message.contextSnapshot);
  const promptTokens = snapshot?.promptTokens;
  if (finiteCount(promptTokens)) return promptTokens;

  const usage = record(message.usage);
  if (usage === null) return null;
  const counts = [usage.input, usage.cacheRead, usage.cacheWrite].filter(finiteCount);
  return counts.length === 0 ? null : counts.reduce((total, count) => total + count, 0);
}


function boundaryEntry(
  raw: Record<string, unknown>,
  fallbackId: string,
  agentLabel: string | null,
  label: string
): TranscriptEntry {
  const summary = raw.type === 'branch_summary' && typeof raw.summary === 'string' && raw.summary.length > 0
    ? `\n\n${raw.summary}`
    : '';
  return {
    message: {
      id: `omp:${entryId(raw, fallbackId)}`,
      role: 'system',
      segments: [{ kind: 'text', text: `${label} (journal entry)${summary}` }],
      timestamp: entryTimestamp(raw),
      agentLabel,
      isSidechain: false,
    },
    meta: null,
  };
}


function entryId(raw: Record<string, unknown>, fallbackId: string): string {
  return typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : fallbackId;
}

function messageTimestamp(message: Record<string, unknown>, raw: Record<string, unknown>): number | null {
  return finiteCount(message.timestamp) ? message.timestamp : entryTimestamp(raw);
}

function entryTimestamp(raw: Record<string, unknown>): number | null {
  if (typeof raw.timestamp !== 'string') return null;
  const parsed = Date.parse(raw.timestamp);
  return Number.isNaN(parsed) ? null : parsed;
}

function preview(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return null;
  return text.length > 2_000 ? `${text.slice(0, 2_000)}…` : text;
}


function finiteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
