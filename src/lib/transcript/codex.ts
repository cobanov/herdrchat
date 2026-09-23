import { codexAssistantText, codexUserText } from './harness';
import type { ChatMessage, MessageSegment } from './message';
import type { TranscriptEntry } from './parser';

const PREVIEW_CHARS = 2_000;

/** Codex writes both semantic events and response items for the same turn.
 * Response items are the canonical history, including desktop-originated input.
 * Do not also render event_msg: that duplicates every assistant/tool message.
 * Metadata events still update the header, without becoming chat bubbles.
 */
export function codexEntry(
  raw: Record<string, unknown>,
  stableId: string,
  agentLabel: string | null
): TranscriptEntry {
  const payload = record(raw.payload);
  const empty: TranscriptEntry = { message: null, meta: null };
  if (payload === null) return empty;

  if (raw.type === 'turn_context') {
    const model = typeof payload.model === 'string' ? payload.model : null;
    const effort = typeof payload.effort === 'string' && /^[a-z]{1,16}$/.test(payload.effort)
      ? payload.effort : null;
    return { message: null, meta: model === null ? null : { model, effort, contextTokens: null } };
  }
  if (raw.type === 'event_msg' && payload.type === 'token_count') {
    const usage = record(record(payload.info)?.last_token_usage);
    const input = usage?.input_tokens;
    // Cached tokens are already part of Codex input_tokens. Do not add twice.
    const contextTokens = typeof input === 'number' && Number.isFinite(input) && input >= 0
      ? input : null;
    return { message: null, meta: contextTokens === null ? null : { model: null, contextTokens } };
  }
  if (raw.type !== 'response_item') return empty;

  const message = responseMessage(payload);
  if (message === null) return empty;
  const timestamp = typeof raw.timestamp === 'string' ? Date.parse(raw.timestamp) : NaN;
  return {
    message: {
      ...message,
      // Timestamp plus content hash stays stable across bounded history, live
      // tails and reconnect rewinds, without merging repeated prompts later on.
      id: `codex:${typeof raw.timestamp === 'string' ? raw.timestamp : ''}:${stableId}`,
      timestamp: Number.isNaN(timestamp) ? null : timestamp,
      agentLabel,
      isSidechain: message.isSidechain ?? false,
    },
    meta: null,
  };
}

function responseMessage(
  payload: Record<string, unknown>
): (Pick<ChatMessage, 'role' | 'segments'> & { isSidechain?: boolean }) | null {
  switch (payload.type) {
    case 'agent_message': {
      // One agent writing to another (Codex 0.155), with an author and a
      // recipient. Chatter between agents, like Claude's subagents, so it is a
      // sidechain: hidden unless "show subagent activity" is on (#121).
      const text = codexAssistantText(contentText(payload.content));
      if (!text.trim()) return null;
      const author = typeof payload.author === 'string' ? payload.author : 'agent';
      const recipient = typeof payload.recipient === 'string' ? payload.recipient : 'agent';
      return { role: 'assistant', segments: [{ kind: 'text', text: `${author} → ${recipient}: ${text}` }], isSidechain: true };
    }
    case 'message': {
      const role = payload.role;
      if (role !== 'user' && role !== 'assistant') return null;
      // Internal analysis is not a user-facing assistant response.
      if (payload.channel === 'analysis') return null;
      const content = contentText(payload.content, role === 'user');
      const text = role === 'assistant' ? codexAssistantText(content) : content;
      if (!text.trim()) return null;
      return { role, segments: [{ kind: 'text', text }] };
    }
    case 'function_call':
    case 'custom_tool_call':
      return { role: 'assistant', segments: [{
        kind: 'toolUse',
        name: typeof payload.name === 'string' ? payload.name : 'tool',
        input: preview(payload.arguments ?? payload.input),
      }] };
    case 'function_call_output':
    case 'custom_tool_call_output':
      return { role: 'user', segments: [{
        kind: 'toolResult', text: outputText(payload.output),
      }] };
    case 'reasoning': {
      // Only the explicitly provided summary is displayable. Never attempt to
      // reconstruct encrypted reasoning or treat its opaque bytes as text.
      const text = contentText(payload.summary);
      const segments: MessageSegment[] = text ? [{ kind: 'thinking', text }] : [];
      return segments.length ? { role: 'assistant', segments } : null;
    }
    default:
      return null;
  }
}

/**
 * The displayable text of a content list. With `omitHarness` (user messages),
 * each text block goes through `codexUserText`, which drops what Codex injects
 * (context, heartbeats, plugin lists) and keeps what was typed (#78).
 */
function contentText(content: unknown, omitHarness = false): string {
  if (typeof content === 'string') return omitHarness ? codexUserText(content) ?? '' : content;
  if (!Array.isArray(content)) return '';
  return content.flatMap((block: unknown) => {
    const value = record(block);
    if (value === null) return [];
    if (['input_text', 'output_text', 'text', 'summary_text'].includes(String(value.type))) {
      if (typeof value.text !== 'string') return [];
      if (!omitHarness) return [value.text];
      const text = codexUserText(value.text);
      return text === null ? [] : [text];
    }
    if (value.type === 'input_image') return ['[Image]'];
    return [];
  }).join('\n');
}

function preview(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

function outputText(value: unknown): string {
  if (typeof value === 'string' || Array.isArray(value)) return contentText(value);
  return value === undefined || value === null ? '' : JSON.stringify(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
