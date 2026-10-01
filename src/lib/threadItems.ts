/**
 * What the thread draws, one entry per row: your messages, the agent's prose,
 * a command's note, and runs of tool activity folded into one summary line.
 *
 * A run is built across transcript lines, not within one. Claude writes one
 * `tool_use` per assistant line and the result comes back as a `user` line of
 * its own, so "Ran 3 commands" is often six ChatMessages. A run continues
 * through assistant lines that are only tools or thinking and through
 * tool-result lines, and ends at anything a person would read: agent text, a
 * picture, your own message, a note.
 *
 * The summary wording follows zeron's (MIT, github.com/zeronsh/zeron,
 * `tool_group_summary`): "Ran 13 commands · called 6 tools · 3 failed".
 */

import type { ChatMessage, MessageSegment } from './transcript/message';

export type ToolKind = 'command' | 'edit' | 'read' | 'search' | 'fetch' | 'todo' | 'question' | 'agent' | 'tool';

export interface ToolCall {
  /** Stable within the thread: the message id plus the segment's index. */
  key: string;
  kind: ToolKind;
  name: string;
  /** The call's input preview, as the transcript gave it. */
  input: string | null;
  /** What the call returned, once its result line has arrived. */
  result: string | null;
  failed: boolean;
  /** The id the result names it by, when the transcript has one. */
  id: string | null;
}

export type ThreadItem =
  | { kind: 'user'; key: string; message: ChatMessage }
  | { kind: 'agent'; key: string; message: ChatMessage }
  | { kind: 'note'; key: string; message: ChatMessage }
  | { kind: 'tools'; key: string; calls: ToolCall[]; thoughts: string[] }
  | { kind: 'subagent'; key: string; call: ToolCall };

/** Which of those is the first of its turn, so the list can open a gap above it. */
export interface PlacedItem {
  item: ThreadItem;
  startsTurn: boolean;
  /** For a user bubble: the last of a run of yours, which carries the time. */
  endsGroup: boolean;
}

export function threadItems(
  messages: readonly ChatMessage[],
  options: { showSidechain: boolean }
): PlacedItem[] {
  const items: ThreadItem[] = [];
  let run: Extract<ThreadItem, { kind: 'tools' }> | null = null;
  const open = new Map<string, ToolCall>();
  let unmatched: ToolCall[] = [];

  const flush = () => {
    if (run !== null && (run.calls.length > 0 || run.thoughts.length > 0)) items.push(run);
    run = null;
  };
  const runFor = (key: string) => (run ??= { kind: 'tools', key: `tools-${key}`, calls: [], thoughts: [] });

  const attach = (segment: Extract<MessageSegment, { kind: 'toolResult' }>) => {
    const call = (segment.toolUseId !== undefined ? open.get(segment.toolUseId) : undefined) ?? unmatched.shift();
    if (call === undefined) return;
    call.result = segment.text;
    call.failed = segment.isError === true || call.failed;
    if (call.id !== null) open.delete(call.id);
    unmatched = unmatched.filter((candidate) => candidate !== call);
  };

  for (const message of messages) {
    if (message.isSidechain && !options.showSidechain) continue;

    if (message.role === 'system') {
      flush();
      items.push({ kind: 'note', key: message.id, message });
      continue;
    }

    if (message.role === 'user') {
      const results = message.segments.filter(
        (segment): segment is Extract<MessageSegment, { kind: 'toolResult' }> => segment.kind === 'toolResult'
      );
      results.forEach(attach);
      if (!isReadable(message)) continue;
      flush();
      items.push({ kind: 'user', key: message.id, message: readableOnly(message) });
      continue;
    }

    // Assistant: prose ends a run, machinery joins it.
    let prose: MessageSegment[] = [];
    const emitProse = (index: number) => {
      if (prose.length === 0) return;
      flush();
      items.push({ kind: 'agent', key: `${message.id}:${index}`, message: { ...message, segments: prose } });
      prose = [];
    };
    message.segments.forEach((segment, index) => {
      switch (segment.kind) {
        case 'text':
          if (segment.text.trim().length === 0) return;
          prose.push(segment);
          return;
        case 'image':
          prose.push(segment);
          return;
        case 'thinking':
          emitProse(index);
          if (segment.text.trim().length > 0) runFor(`${message.id}:${index}`).thoughts.push(segment.text);
          return;
        case 'toolResult':
          attach(segment);
          return;
        case 'toolUse': {
          emitProse(index);
          const call: ToolCall = {
            key: `${message.id}:${index}`,
            kind: toolKind(segment.name),
            name: segment.name,
            input: segment.input,
            result: null,
            failed: false,
            id: segment.id ?? null,
          };
          if (call.id !== null) open.set(call.id, call);
          else unmatched.push(call);
          if (call.kind === 'agent') {
            // A subagent is its own card, never folded into "called N tools".
            flush();
            items.push({ kind: 'subagent', key: call.key, call });
          } else {
            runFor(call.key).calls.push(call);
          }
          return;
        }
      }
    });
    emitProse(message.segments.length);
  }
  flush();

  return items.map((item, index) => {
    const previous = items[index - 1];
    const next = items[index + 1];
    return {
      item,
      startsTurn: previous === undefined || (item.kind === 'user') !== (previous.kind === 'user'),
      endsGroup: item.kind !== 'user' || next?.kind !== 'user',
    };
  });
}

/** "Ran 13 commands · edited 2 files · called 6 tools · 3 failed". */
export function toolRunSummary(calls: readonly ToolCall[], thoughts: number): string {
  const count = (kind: ToolKind) => calls.filter((call) => call.kind === kind).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const edited = new Set(calls.filter((call) => call.kind === 'edit').map((call) => editedPath(call) ?? call.key)).size;
  const failed = calls.filter((call) => call.failed).length;

  const parts = [
    thoughts > 0 ? (thoughts === 1 ? 'thought' : `thought ${thoughts} times`) : null,
    count('command') > 0 ? `ran ${plural(count('command'), 'command', 'commands')}` : null,
    edited > 0 ? `edited ${plural(edited, 'file', 'files')}` : null,
    count('read') > 0 ? `read ${plural(count('read'), 'file', 'files')}` : null,
    count('search') > 0 ? `searched ${plural(count('search'), 'time', 'times')}` : null,
    count('fetch') > 0 ? `fetched ${plural(count('fetch'), 'page', 'pages')}` : null,
    count('todo') > 0 ? 'updated todos' : null,
    count('question') > 0 ? `asked ${plural(count('question'), 'question', 'questions')}` : null,
    count('tool') > 0 ? `called ${plural(count('tool'), 'tool', 'tools')}` : null,
    failed > 0 ? `${failed} failed` : null,
  ].filter((part): part is string => part !== null);

  const line = parts.join(' · ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** The word a call's row leads with, and what follows it. */
export function toolCallLine(call: ToolCall): { verb: string; detail: string } {
  const field = (name: string) => inputField(call.input, name);
  switch (call.kind) {
    case 'command':
      return { verb: 'Run', detail: field('command') ?? field('cmd') ?? call.input ?? '' };
    case 'edit':
      return { verb: 'Edit', detail: basename(editedPath(call)) ?? call.input ?? '' };
    case 'read':
      return { verb: 'Read', detail: basename(field('file_path') ?? field('path')) ?? call.input ?? '' };
    case 'search':
      return { verb: 'Search', detail: field('pattern') ?? field('query') ?? call.input ?? '' };
    case 'fetch':
      return { verb: 'Fetch', detail: field('url') ?? call.input ?? '' };
    case 'todo':
      return { verb: 'Todo', detail: 'updated the list' };
    case 'question':
      return { verb: 'Ask', detail: field('question') ?? 'a question' };
    case 'agent':
      return { verb: 'Agent', detail: field('description') ?? field('subagent_type') ?? call.input ?? '' };
    case 'tool':
      return { verb: call.name.startsWith('mcp__') ? 'MCP' : 'Tool', detail: toolLabel(call.name) };
  }
}

export function toolKind(name: string): ToolKind {
  // Claude names its tools in PascalCase, Codex and OMP in lower case.
  const key = name.toLowerCase();
  if (COMMAND_TOOLS.has(key)) return 'command';
  if (EDIT_TOOLS.has(key)) return 'edit';
  if (key === 'read') return 'read';
  if (SEARCH_TOOLS.has(key)) return 'search';
  if (FETCH_TOOLS.has(key)) return 'fetch';
  if (TODO_TOOLS.has(key)) return 'todo';
  if (key === 'askuserquestion') return 'question';
  if (key === 'agent' || key === 'task') return 'agent';
  return 'tool';
}

// MARK: - Internals

/** Tool names, lower-cased: Claude's, Codex's and OMP's. */
const COMMAND_TOOLS = new Set(['bash', 'bashoutput', 'exec', 'exec_command', 'shell', 'local_shell', 'container.exec', 'write_stdin']);
const EDIT_TOOLS = new Set(['write', 'edit', 'multiedit', 'notebookedit', 'apply_patch']);
const SEARCH_TOOLS = new Set(['grep', 'glob', 'find', 'ls', 'websearch', 'toolsearch', 'web_search']);
const FETCH_TOOLS = new Set(['webfetch', 'fetch', 'web_fetch']);
const TODO_TOOLS = new Set(['todowrite', 'taskcreate', 'taskupdate', 'update_plan', 'todo']);

/** A turn with something a person would read: text or a picture. */
function isReadable(message: ChatMessage): boolean {
  return message.segments.some(
    (segment) => (segment.kind === 'text' && segment.text.trim().length > 0) || segment.kind === 'image'
  );
}

function readableOnly(message: ChatMessage): ChatMessage {
  const segments = message.segments.filter((segment) => segment.kind === 'text' || segment.kind === 'image');
  return segments.length === message.segments.length ? message : { ...message, segments };
}

function editedPath(call: ToolCall): string | null {
  return inputField(call.input, 'file_path') ?? inputField(call.input, 'notebook_path') ?? inputField(call.input, 'path');
}

/**
 * One field out of the flattened input preview, `{command: ls -la, description: …}`.
 * The preview is display text, not JSON, so this is a best effort: a value
 * runs to the next `, key:` or the closing brace.
 */
function inputField(input: string | null, name: string): string | null {
  if (input === null) return null;
  // Nested one level too: AskUserQuestion's `{questions: [{question: …}]}`.
  const match = new RegExp(`(?:^\\{|\\[\\{|, )${name}: ([\\s\\S]*?)(?=, [a-z_]+: |\\}\\]|\\}$)`).exec(input);
  const value = match?.[1]?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

function basename(path: string | null): string | null {
  if (path === null) return null;
  return path.split('/').filter(Boolean).pop() ?? path;
}

/** "mcp__claude_ai_Linear__save_issue" → "Linear save_issue". */
function toolLabel(name: string): string {
  if (!name.startsWith('mcp__')) return name;
  const [, server = '', tool = ''] = name.split('__');
  return `${server.replace(/^claude_ai_/, '').replaceAll('_', ' ')} ${tool}`.trim();
}
