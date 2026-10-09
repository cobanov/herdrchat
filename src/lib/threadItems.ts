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

import { isFailedStatus } from './subagents/taskNotice';
import { scriptMeta, WORKFLOW_FALLBACK_NAME } from './subagents/scriptMeta';
import { runIdFromResult } from './subagents/workflowRun';
import type { ChatMessage, MessageSegment, TaskNotice } from './transcript/message';

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
  /**
   * `key` is the list's identity for the row and names the run by its LAST
   * call or thought, because older history is prepended: a page whose end is
   * the start of the run at the top of the list adds calls to its front, and a
   * row whose key changed under the reader is one the list cannot keep in
   * place, so the conversation jumped by the whole page. `runKey` names it by
   * its first, which is stable while a live run grows, and keeps the run open
   * or closed.
   */
  | { kind: 'tools'; key: string; runKey: string; calls: ToolCall[]; thoughts: string[] }
  /**
   * Work handed to a second agent (`Agent`, `Task` in older transcripts) or
   * to a workflow of them (`Workflow`): a card of its own where the call
   * sits, never a line in "called N tools". `call.id` is the tool use id the
   * agent's meta names.
   */
  | { kind: 'subagent'; key: string; call: ToolCall; delegation: Delegation }
  | {
      kind: 'workflow';
      key: string;
      call: ToolCall;
      delegation: Delegation;
      /** From the call's result, `Run ID: wf_…`; null until the result lands. */
      runId: string | null;
      /** The script's own name, or "Workflow"; the run file's name wins once it is read. */
      name: string;
      description: string | null;
    };

export type DelegationState = 'running' | 'done' | 'failed';

/**
 * Where a subagent's or a workflow's work stands, as far as the main
 * transcript can tell.
 *
 * A foreground agent runs until its `tool_result` arrives. A background one
 * (and every workflow) gets a result at once that only says it launched; it
 * runs until a `<task-notification>` names its call. Reading the launch as
 * the end showed every background agent "done" the moment it started.
 */
export interface Delegation {
  state: DelegationState;
  /** The call's result only said it launched; the end comes as a notification. */
  background: boolean;
  /** The agent's id, when the launch result reported it (a background agent). */
  agentId: string | null;
  /** What the work handed back, once it ended; null while it runs or when it said nothing. */
  result: string | null;
  /** When the call was made and when its end arrived, epoch ms, when the transcript said. */
  startedAt: number | null;
  endedAt: number | null;
  /** How long it ran: the notification's own figure, else the time between the two lines. */
  durationMs: number | null;
  tokens: number | null;
  toolUses: number | null;
}

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
  /** Calls that are cards, with when they were made and when their result came. */
  const delegated: { item: Extract<ThreadItem, { kind: 'subagent' | 'workflow' }>; at: number | null }[] = [];
  const resultAt = new Map<ToolCall, number | null>();
  const notices = new Map<string, { notice: TaskNotice; at: number | null }>();
  let at: number | null = null;

  const flush = () => {
    if (run !== null && (run.calls.length > 0 || run.thoughts.length > 0)) items.push(run);
    run = null;
  };
  const runFor = (key: string) => {
    run ??= { kind: 'tools', key: '', runKey: `tools-${key}`, calls: [], thoughts: [] };
    run.key = `tools-${key}`;
    return run;
  };

  const attach = (segment: Extract<MessageSegment, { kind: 'toolResult' }>) => {
    const call = (segment.toolUseId !== undefined ? open.get(segment.toolUseId) : undefined) ?? unmatched.shift();
    if (call === undefined) return;
    call.result = segment.text;
    call.failed = segment.isError === true || call.failed;
    resultAt.set(call, at);
    if (call.id !== null) open.delete(call.id);
    unmatched = unmatched.filter((candidate) => candidate !== call);
  };

  for (const message of messages) {
    if (message.isSidechain && !options.showSidechain) continue;
    at = message.timestamp;
    // A background task's end: kept by the call it names, never a row. The
    // same task can notify more than once (an agent resumed); the last wins.
    for (const segment of message.segments) {
      if (segment.kind === 'taskNotice') notices.set(segment.notice.toolUseId, { notice: segment.notice, at });
    }

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
        case 'taskNotice':
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
          if (call.kind === 'agent' || isWorkflowTool(call.name)) {
            // A subagent is its own card, never folded into "called N tools".
            flush();
            const item: Extract<ThreadItem, { kind: 'subagent' | 'workflow' }> = call.kind === 'agent'
              ? { kind: 'subagent', key: call.key, call, delegation: RUNNING }
              : { kind: 'workflow', key: call.key, call, delegation: RUNNING, runId: null, ...workflowTitle(call.input) };
            items.push(item);
            delegated.push({ item, at });
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

  // Results and notices arrive after the card was placed, so its state is
  // settled once the whole window has been read.
  for (const { item, at: startedAt } of delegated) {
    const notice = item.call.id === null ? undefined : notices.get(item.call.id);
    item.delegation = delegationOf(item.call, startedAt, resultAt.get(item.call) ?? null, notice);
    if (item.kind === 'workflow') item.runId = runIdFromResult(item.call.result);
  }

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

/**
 * "Ran 13 commands · edited 2 files · called 6 tools · 3 failed".
 *
 * Subagents and workflows are cards of their own and never counted here,
 * failures included: "1 failed" under a run whose every call succeeded sent
 * the reader looking for a failure that was in the card below.
 */
export function toolRunSummary(allCalls: readonly ToolCall[], thoughts: number): string {
  const calls = allCalls.filter((call) => call.kind !== 'agent' && !isWorkflowTool(call.name));
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

/**
 * Claude's `Workflow` tool, which runs many subagents under phases. Its calls
 * keep the generic `tool` kind (a chip, were one ever drawn) and become a card.
 */
export function isWorkflowTool(name: string): boolean {
  return name === 'Workflow';
}

/**
 * The subagent's own fields from an `Agent` call's input: what it was asked
 * to do, which kind of agent, which model. Null where the call did not say.
 */
export function subagentInput(call: ToolCall): { description: string | null; agentType: string | null; model: string | null } {
  return {
    description: inputField(call.input, 'description'),
    agentType: inputField(call.input, 'subagent_type'),
    model: inputField(call.input, 'model'),
  };
}

// MARK: - Internals

const RUNNING: Delegation = {
  state: 'running', background: false, agentId: null, result: null,
  startedAt: null, endedAt: null, durationMs: null, tokens: null, toolUses: null,
};

/** "Async agent launched successfully…", "Workflow launched in background…". */
const LAUNCHED = /^\s*(?:Async agent launched|Workflow launched)\b/;

function delegationOf(
  call: ToolCall,
  startedAt: number | null,
  resultAt: number | null,
  noticed: { notice: TaskNotice; at: number | null } | undefined
): Delegation {
  const background = call.result !== null && LAUNCHED.test(call.result);
  const agentId = background ? /\bagentId: ([A-Za-z0-9_-]+)/.exec(call.result ?? '')?.[1] ?? null : null;
  const base = { ...RUNNING, background, agentId, startedAt };
  const elapsed = (end: number | null) => (end !== null && startedAt !== null && end >= startedAt ? end - startedAt : null);

  if (call.result === null) return base;
  // A foreground agent's result is its end. So is a launch that failed outright
  // (refused, the classifier timed out): an error result, not a launch.
  if (!background) {
    return {
      ...base,
      state: call.failed ? 'failed' : 'done',
      result: call.result,
      endedAt: resultAt,
      durationMs: elapsed(resultAt),
    };
  }
  if (noticed === undefined) return base;
  const { notice, at } = noticed;
  return {
    ...base,
    state: isFailedStatus(notice.status) ? 'failed' : 'done',
    result: notice.result ?? notice.summary,
    endedAt: at,
    durationMs: notice.durationMs ?? elapsed(at),
    tokens: notice.tokens,
    toolUses: notice.toolUses,
  };
}

/** A workflow card's title before its run file is read: the script's meta, or "Workflow". */
function workflowTitle(input: string | null): { name: string; description: string | null } {
  const meta = scriptMeta(input);
  return { name: meta.name ?? WORKFLOW_FALLBACK_NAME, description: meta.description };
}

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
