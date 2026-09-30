import type { ChatMessage, MessageSegment } from '../transcript/message';
import { threadItems, toolCallLine, toolKind, toolRunSummary, type ToolCall } from '../threadItems';

let seq = 0;
const message = (role: ChatMessage['role'], segments: MessageSegment[], extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m${(seq += 1)}`,
  role,
  segments,
  timestamp: seq,
  agentLabel: null,
  isSidechain: false,
  ...extra,
});
const text = (value: string): MessageSegment => ({ kind: 'text', text: value });
const use = (name: string, input: string | null, id?: string): MessageSegment => ({ kind: 'toolUse', name, input, ...(id ? { id } : {}) });
const result = (value: string, toolUseId?: string, isError = false): MessageSegment => ({
  kind: 'toolResult', text: value, ...(toolUseId ? { toolUseId } : {}), ...(isError ? { isError } : {}),
});
const kinds = (messages: ChatMessage[]) => threadItems(messages, { showSidechain: false }).map((placed) => placed.item.kind);

describe('thread items', () => {
  // Claude writes one tool_use per line and each result as a user line.
  it('folds a run of tools across transcript lines into one row', () => {
    const messages = [
      message('user', [text('Fix the build')]),
      message('assistant', [text('Looking.')]),
      message('assistant', [use('Bash', '{command: npm test}', 't1')]),
      message('user', [result('1 failed', 't1', true)]),
      message('assistant', [use('Read', '{file_path: /a/b.ts}', 't2')]),
      message('user', [result('…', 't2')]),
      message('assistant', [use('Edit', '{file_path: /a/b.ts, old_string: x, new_string: y}', 't3')]),
      message('user', [result('ok', 't3')]),
      message('assistant', [text('Fixed.')]),
    ];
    const items = threadItems(messages, { showSidechain: false });
    expect(items.map((placed) => placed.item.kind)).toEqual(['user', 'agent', 'tools', 'agent']);
    const run = items[2]!.item;
    if (run.kind !== 'tools') throw new Error('expected a run');
    expect(run.calls.map((call) => [call.kind, call.failed, call.result])).toEqual([
      ['command', true, '1 failed'],
      ['read', false, '…'],
      ['edit', false, 'ok'],
    ]);
    expect(toolRunSummary(run.calls, run.thoughts.length)).toBe('Ran 1 command · edited 1 file · read 1 file · 1 failed');
  });

  it('pairs results in order when the transcript names no ids', () => {
    const messages = [
      message('assistant', [use('exec_command', '{cmd: ls}'), use('exec_command', '{cmd: pwd}')]),
      message('user', [result('a')]),
      message('user', [result('b')]),
    ];
    const run = threadItems(messages, { showSidechain: false })[0]!.item;
    expect(run.kind === 'tools' && run.calls.map((call) => call.result)).toEqual(['a', 'b']);
  });

  it('ends a run at anything a person reads, and splits prose around tools in one line', () => {
    expect(kinds([
      message('assistant', [use('Bash', null), text('Half way.'), use('Bash', null)]),
      message('user', [text('keep going')]),
      message('assistant', [use('Grep', null)]),
      message('system', [text('Set model to Opus')]),
      message('assistant', [use('Glob', null)]),
    ])).toEqual(['tools', 'agent', 'tools', 'user', 'tools', 'note', 'tools']);
  });

  it('gives a subagent its own card', () => {
    expect(kinds([
      message('assistant', [use('Bash', null), use('Agent', '{description: library_backup}'), use('Bash', null)]),
    ])).toEqual(['tools', 'subagent', 'tools']);
  });

  it('counts thinking in the run, and hides sidechains unless asked', () => {
    const messages = [
      message('assistant', [{ kind: 'thinking', text: 'hmm' }, use('Bash', null)]),
      message('assistant', [text('inner')], { isSidechain: true }),
    ];
    const items = threadItems(messages, { showSidechain: false });
    expect(items.map((placed) => placed.item.kind)).toEqual(['tools']);
    const run = items[0]!.item;
    expect(run.kind === 'tools' && toolRunSummary(run.calls, run.thoughts.length)).toBe('Thought · ran 1 command');
    expect(threadItems(messages, { showSidechain: true }).map((placed) => placed.item.kind)).toEqual(['tools', 'agent']);
  });

  it('marks where a turn changes hands and where your run of messages ends', () => {
    const placed = threadItems([
      message('user', [text('a')]),
      message('user', [text('b')]),
      message('assistant', [text('c')]),
      message('assistant', [use('Bash', null)]),
    ], { showSidechain: false });
    expect(placed.map((entry) => [entry.startsTurn, entry.endsGroup])).toEqual([
      [true, false],
      [false, true],
      [true, true],
      [false, true],
    ]);
  });
});

describe('tool wording', () => {
  const call = (name: string, input: string | null): ToolCall => ({ key: 'k', kind: toolKind(name), name, input, result: null, failed: false, id: null });

  it('counts files edited, not edits', () => {
    const calls = [call('Edit', '{file_path: /a.ts}'), call('Edit', '{file_path: /a.ts}'), call('Write', '{file_path: /b.ts}')];
    expect(toolRunSummary(calls, 0)).toBe('Edited 2 files');
  });

  it('says what each call did in a line', () => {
    expect(toolCallLine(call('Bash', '{command: npm test -- --watch=false, description: Run tests}'))).toEqual({ verb: 'Run', detail: 'npm test -- --watch=false' });
    expect(toolCallLine(call('Read', '{file_path: /repo/src/app.ts}'))).toEqual({ verb: 'Read', detail: 'app.ts' });
    expect(toolCallLine(call('mcp__claude_ai_Linear__save_issue', '{}'))).toEqual({ verb: 'MCP', detail: 'Linear save_issue' });
    expect(toolRunSummary([call('mcp__x__y', null), call('WebFetch', null), call('TodoWrite', null)], 0)).toBe('Fetched 1 page · updated todos · called 1 tool');
    // A question the agent asked is not "called 1 tool".
    expect(toolRunSummary([call('AskUserQuestion', '{questions: [{question: Pick a color}]}')], 0)).toBe('Asked 1 question');
    expect(toolCallLine(call('AskUserQuestion', '{questions: [{question: Pick a color, header: Color}]}'))).toEqual({ verb: 'Ask', detail: 'Pick a color' });
  });
});
