import { splitImages } from './images';
import type { MessageSegment } from './message';
import type { TranscriptEntry } from './parser';
import type { SessionMeta } from './sessionMeta';

/**
 * Maps Antigravity CLI's conversation log to chat bubbles, one step a line
 * (`brain/<id>/.system_generated/logs/transcript.jsonl`, measured against agy
 * 1.3.6). A step is the person's input (`USER_INPUT`), the model's turn
 * (`PLANNER_RESPONSE`: its thinking, its reply and the tools it calls), or a
 * tool's output (`GENERIC`). The steps carry no call ids, but an output is the
 * step right after its call's, so that names the call. Pairing by order alone
 * gave every later output to the call before its own once a call was
 * interrupted and never got one.
 */
export function agyEntry(raw: Record<string, unknown>, agentLabel: string | null): TranscriptEntry {
  const created = typeof raw.created_at === 'string' ? Date.parse(raw.created_at) : Number.NaN;
  const index = finite(raw.step_index) ?? -1;
  const content = typeof raw.content === 'string' ? raw.content : '';
  const entry = (role: 'user' | 'assistant', segments: MessageSegment[], meta: SessionMeta | null = null): TranscriptEntry => ({
    message: segments.length === 0 ? null : {
      // shortcut: the step's time and number name it, in case agy ever rewrites
      // a step as it finishes; two conversations in one chat would need both
      // to collide. Upgrade if agy logs an id of its own.
      id: `agy:${String(raw.created_at)}:${String(raw.step_index)}`,
      role,
      segments,
      timestamp: Number.isFinite(created) ? created : null,
      agentLabel,
      isSidechain: false,
    },
    meta,
  });

  switch (raw.type) {
    case 'USER_INPUT': {
      const meta = modelChange(content);
      // agy wraps what was typed with the time and any change of settings.
      if (raw.source !== 'USER_EXPLICIT') return entry('user', [], meta);
      const typed = /<USER_REQUEST>\n?([\s\S]*?)\n?<\/USER_REQUEST>/.exec(content)?.[1] ?? '';
      const { text, paths } = splitImages(typed);
      return entry('user', [
        ...(text.length > 0 ? [{ kind: 'text' as const, text }] : []),
        ...paths.map((path) => ({ kind: 'image' as const, path })),
      ], meta);
    }
    case 'PLANNER_RESPONSE': {
      const thinking = typeof raw.thinking === 'string' ? raw.thinking.trim() : '';
      const calls = Array.isArray(raw.tool_calls) ? raw.tool_calls.map(record).filter((call) => call !== null) : [];
      const input = finite(raw.input_tokens);
      return entry('assistant', [
        ...(thinking.length > 0 ? [{ kind: 'thinking' as const, text: thinking }] : []),
        ...(content.trim().length > 0 ? [{ kind: 'text' as const, text: content.trim() }] : []),
        ...calls.map((call, position) => ({
          kind: 'toolUse' as const,
          name: typeof call.name === 'string' ? call.name : 'tool',
          input: toolInput(call.args),
          id: callId(index, position),
        })),
      ], input === null ? null : { model: null, contextTokens: input + (finite(raw.cache_read_tokens) ?? 0) });
    }
    case 'GENERIC':
      // "Created At" and "Completed At" lead every output; the rest is the tool's.
      return entry('user', [{
        kind: 'toolResult',
        text: content.replace(/^Created At: .*\n(?:Completed At: .*\n)?\n?/, '').replaceAll('\r\n', '\n').trim(),
        // A step with several calls has its outputs after it; past the first,
        // no call has this id and the oldest open call takes it.
        toolUseId: callId(index - 1, 0),
      }]);
    default:
      return { message: null, meta: null };
  }
}

/** True for a line of agy's conversation log. */
export function isAgyStep(raw: Record<string, unknown>): boolean {
  return typeof raw.step_index === 'number' && typeof raw.type === 'string' && typeof raw.source === 'string';
}

/**
 * A call's id, by its step and its place in it. shortcut: two Antigravity
 * conversations in one workspace chat share the ids; upgrade if agy logs ids.
 */
function callId(step: number, position: number): string {
  return `agy-${step}:${position}`;
}

/** The model a prompt switched to: agy says so in the prompt it records. */
function modelChange(content: string): SessionMeta | null {
  const model = /setting `Model Selection` from .*? to (.+?)\.(?:\s|$)/.exec(content)?.[1];
  return model === undefined ? null : { model, contextTokens: null };
}

/**
 * A call's arguments, each of which agy logs as JSON text, decoded, under the
 * names the thread's tool rows read (`command`, `file_path`).
 */
function toolInput(args: unknown): string | null {
  const fields = record(args);
  if (fields === null) return null;
  const decoded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'toolAction') continue;
    decoded[ARG_NAMES[key] ?? key] = typeof value === 'string' ? parsed(value) : value;
  }
  return JSON.stringify(decoded);
}

const ARG_NAMES: Readonly<Record<string, string>> = {
  CommandLine: 'command',
  Cwd: 'cwd',
  AbsolutePath: 'file_path',
  toolSummary: 'description',
};

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
