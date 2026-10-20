import { splitImages } from './images';
import type { MessageSegment } from './message';
import type { TranscriptEntry } from './parser';

/**
 * Maps a log of Agent Client Protocol `session/update` notifications, one a
 * line, to chat bubbles. Grok writes its conversation this way
 * (`~/.grok/sessions/<cwd>/<id>/updates.jsonl`, measured against Grok 1.0.52),
 * with its own extensions under `_meta` and `_x.ai/session/update`. Grok
 * coalesces each message into one chunk, so a line is a whole bubble.
 *
 * A tool call's result is its final `tool_call_update`, the one with a
 * `completed` or `failed` status; the updates before it only stream progress.
 */
export function acpEntry(
  raw: Record<string, unknown>,
  fallbackId: string,
  agentLabel: string | null
): TranscriptEntry {
  const params = record(raw.params);
  const update = record(params?.update);
  if (params === null || update === null) return EMPTY_ENTRY;
  const meta = record(params._meta);
  const updateMeta = record(update._meta);

  const seconds = finite(raw.timestamp);
  const message = (role: 'user' | 'assistant', segments: MessageSegment[]): TranscriptEntry => ({
    message: segments.length === 0 ? null : {
      id: `acp:${typeof meta?.eventId === 'string' ? meta.eventId : fallbackId}`,
      role,
      segments,
      timestamp: finite(meta?.agentTimestampMs) ?? (seconds === null ? null : seconds * 1000),
      agentLabel,
      isSidechain: false,
    },
    // The model is named on the prompt, so the header knows it from the first turn.
    meta: typeof updateMeta?.modelId === 'string' && updateMeta.modelId.length > 0
      ? { model: updateMeta.modelId, contextTokens: null }
      : null,
  });

  switch (update.sessionUpdate) {
    case 'user_message_chunk': {
      // Prompts Grok writes itself (a background task waking it) are not the person's.
      if (updateMeta?.syntheticPrompt === true || updateMeta?.hideFromScrollback === true) return message('user', []);
      const { text, paths } = splitImages(contentText(update.content));
      return message('user', [
        ...(text.length > 0 ? [{ kind: 'text' as const, text }] : []),
        ...paths.map((path) => ({ kind: 'image' as const, path })),
      ]);
    }
    case 'agent_message_chunk': {
      const text = contentText(update.content);
      return message('assistant', text.length > 0 ? [{ kind: 'text', text }] : []);
    }
    case 'agent_thought_chunk': {
      const text = contentText(update.content);
      return message('assistant', text.length > 0 ? [{ kind: 'thinking', text }] : []);
    }
    case 'tool_call': {
      const tool = record(updateMeta?.['x.ai/tool']);
      const name = typeof tool?.name === 'string' ? tool.name : typeof update.title === 'string' ? update.title : 'tool';
      return message('assistant', [{
        kind: 'toolUse',
        name,
        input: preview(update.rawInput),
        ...(typeof update.toolCallId === 'string' ? { id: update.toolCallId } : {}),
      }]);
    }
    case 'tool_call_update': {
      if (update.status !== 'completed' && update.status !== 'failed') return EMPTY_ENTRY;
      return message('user', [{
        kind: 'toolResult',
        text: toolText(update.content),
        ...(typeof update.toolCallId === 'string' ? { toolUseId: update.toolCallId } : {}),
        ...(update.status === 'failed' ? { isError: true } : {}),
      }]);
    }
    default:
      // Turn ends, plans, modes, background tasks, memory: not conversation.
      return EMPTY_ENTRY;
  }
}

/** True for a line of an ACP update log. */
export function isAcpUpdate(raw: Record<string, unknown>): boolean {
  return (raw.method === 'session/update' || raw.method === '_x.ai/session/update') &&
    record(record(raw.params)?.update) !== null;
}

const EMPTY_ENTRY: TranscriptEntry = { message: null, meta: null };

/** An ACP content block's text: only `text` blocks carry any. */
function contentText(content: unknown): string {
  const block = record(content);
  return block?.type === 'text' && typeof block.text === 'string' ? block.text : '';
}

/** A tool's output: its `content` blocks' text, and a diff's path. */
function toolText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content.flatMap((item) => {
    const block = record(item);
    if (block?.type === 'content') {
      const text = contentText(block.content);
      return text.length > 0 ? [text] : [];
    }
    return block?.type === 'diff' && typeof block.path === 'string' ? [`Edited ${block.path}`] : [];
  }).join('\n');
}

function preview(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return null;
  return text.length > 2_000 ? `${text.slice(0, 2_000)}…` : text;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
