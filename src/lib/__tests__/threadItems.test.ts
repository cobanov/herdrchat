import type { ChatMessage, MessageSegment, TaskNotice } from '../transcript/message';
import { subagentInput, threadItems, toolCallLine, toolKind, toolRunSummary, type ThreadItem, type ToolCall } from '../threadItems';

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
  // Older history is prepended. A page that ends inside the run at the top of
  // the list adds calls to its front, and a row whose key changed is one the
  // list cannot hold in place: the conversation jumped by the whole page.
  it('keeps a run at the top under the same list key when older calls join it', () => {
    const older = [
      message('user', [text('Check the screens')]),
      message('assistant', [use('Read', '{file_path: /tmp/a.png}', 'r1')]),
      message('user', [result('[image]', 'r1')]),
    ];
    const shown = [
      message('assistant', [use('Read', '{file_path: /tmp/b.png}', 'r2')]),
      message('user', [result('[image]', 'r2')]),
      message('assistant', [text('Both look right.')]),
    ];
    const run = (messages: ChatMessage[]) => {
      const item = threadItems(messages, { showSidechain: false }).find((placed) => placed.item.kind === 'tools')!.item;
      if (item.kind !== 'tools') throw new Error('expected a run');
      return item;
    };
    const before = run(shown);
    const after = run([...older, ...shown]);
    expect(after.calls).toHaveLength(2);
    expect(after.key).toBe(before.key);
  });

  // The other end: a live run grows at its end, and stays open or closed as it does.
  it('keeps a growing run under the same open-state key', () => {
    const first = [message('user', [text('Go')]), message('assistant', [use('Bash', '{command: ls}', 'b1')])];
    const grown = [...first, message('user', [result('ok', 'b1')]), message('assistant', [use('Bash', '{command: pwd}', 'b2')])];
    const runKey = (messages: ChatMessage[]) => {
      const item = threadItems(messages, { showSidechain: false }).at(-1)!.item;
      return item.kind === 'tools' ? item.runKey : null;
    };
    expect(runKey(grown)).toBe(runKey(first));
    expect(runKey(first)).not.toBeNull();
  });

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

describe('subagents and workflows', () => {
  const notice = (toolUseId: string, status: string, extra: Partial<TaskNotice> = {}): MessageSegment => ({
    kind: 'taskNotice',
    notice: { toolUseId, status, summary: null, result: null, tokens: null, toolUses: null, durationMs: null, ...extra },
  });
  const cards = (messages: ChatMessage[]) =>
    threadItems(messages, { showSidechain: false })
      .map((placed) => placed.item)
      .filter((item): item is Extract<ThreadItem, { kind: 'subagent' | 'workflow' }> => item.kind === 'subagent' || item.kind === 'workflow');
  const AGENT_INPUT = '{description: Check the release notes for broken links, subagent_type: general-purpose, model: sonnet, prompt: Read…}';
  const LAUNCHED = 'Async agent launched successfully. (This tool result is internal metadata …)\nagentId: a53e546bf8054816f (internal ID - do not mention to user.)\nThe agent is working in the background.';
  const WORKFLOW_INPUT = "{script: export const meta = {\n  name: 'release-review',\n  description: 'Review the release in two passes',\n}\nexport default async () => {}}";
  const WORKFLOW_LAUNCHED = 'Workflow launched in background. Task ID: w2z9jiho1\nSummary: Review the release in two passes\nRun ID: wf_31a24808-cdf\n';

  it('places each where its call sits, and keeps it out of the run around it', () => {
    const messages = [
      message('assistant', [use('Bash', '{command: ls}', 'b1')]),
      message('user', [result('ok', 'b1')]),
      message('assistant', [use('Agent', AGENT_INPUT, 'ag1')]),
      message('assistant', [use('Workflow', WORKFLOW_INPUT, 'wf1')]),
      message('assistant', [use('Read', '{file_path: /a.ts}', 'r1')]),
    ];
    expect(kinds(messages)).toEqual(['tools', 'subagent', 'workflow', 'tools']);
    expect(subagentInput(cards(messages)[0]!.call)).toEqual({
      description: 'Check the release notes for broken links', agentType: 'general-purpose', model: 'sonnet',
    });
    expect(cards(messages)[1]).toMatchObject({ name: 'release-review', description: 'Review the release in two passes', runId: null });
  });

  // A foreground agent: running until its result, then done or failed with it.
  it('runs a foreground agent until its result, and says how long it took', () => {
    const call = message('assistant', [use('Task', AGENT_INPUT, 'ag1')], { timestamp: 1_000 });
    expect(cards([call])[0]!.delegation).toMatchObject({ state: 'running', background: false, result: null });
    const done = cards([call, message('user', [result('No broken links.', 'ag1')], { timestamp: 61_000 })])[0]!.delegation;
    expect(done).toMatchObject({ state: 'done', result: 'No broken links.', startedAt: 1_000, endedAt: 61_000, durationMs: 60_000 });
    const failed = cards([call, message('user', [result('Permission denied', 'ag1', true)], { timestamp: 2_000 })])[0]!.delegation;
    expect(failed.state).toBe('failed');
  });

  // A background agent's result only says it launched; it ends on the
  // notification. Reading the launch as the end showed it done at once.
  it('keeps a background agent running until its notification, then takes the result and usage from it', () => {
    const launched = [
      message('assistant', [use('Agent', AGENT_INPUT, 'ag1')], { timestamp: 1_000 }),
      message('user', [result(LAUNCHED, 'ag1')], { timestamp: 1_100 }),
    ];
    expect(cards(launched)[0]!.delegation).toMatchObject({ state: 'running', background: true, agentId: 'a53e546bf8054816f', result: null });
    const ended = cards([
      ...launched,
      message('assistant', [text('Waiting on the agent.')]),
      message('user', [notice('ag1', 'completed', { summary: 'Agent finished', result: 'Two links were dead.', tokens: 900, toolUses: 7, durationMs: 42_000 })], { timestamp: 50_000 }),
    ]);
    expect(ended[0]!.delegation).toMatchObject({
      state: 'done', result: 'Two links were dead.', durationMs: 42_000, tokens: 900, toolUses: 7, endedAt: 50_000,
    });
    const killed = cards([...launched, message('user', [notice('ag1', 'killed', { summary: 'Agent stopped' })], { timestamp: 9_100 })]);
    expect(killed[0]!.delegation).toMatchObject({ state: 'failed', result: 'Agent stopped', durationMs: 8_100 });
  });

  it('runs a workflow until its notification, with its run id from the launch', () => {
    const launched = [
      message('assistant', [use('Workflow', WORKFLOW_INPUT, 'wf1')]),
      message('user', [result(WORKFLOW_LAUNCHED, 'wf1')]),
    ];
    expect(cards(launched)[0]).toMatchObject({ kind: 'workflow', runId: 'wf_31a24808-cdf', delegation: { state: 'running', background: true } });
    const done = cards([...launched, message('user', [notice('wf1', 'completed', { result: '{"ok":true}' })])]);
    expect(done[0]!.delegation).toMatchObject({ state: 'done', result: '{"ok":true}' });
    // Without a meta block the card is "Workflow".
    expect(cards([message('assistant', [use('Workflow', '{script: export default async () => {}}', 'wf2')])])[0])
      .toMatchObject({ name: 'Workflow' });
  });

  // A notice is no row, and it never pairs with a call it does not name: a
  // background Bash notifies too, and Codex calls have no ids to match.
  it('draws nothing for a notice, and pairs it only by id', () => {
    const messages = [
      message('assistant', [use('exec_command', '{cmd: ls}')]),
      message('user', [notice('someone-else', 'completed', { result: 'not yours' })]),
      message('user', [result('a')]),
    ];
    const items = threadItems(messages, { showSidechain: false });
    expect(items.map((placed) => placed.item.kind)).toEqual(['tools']);
    const run = items[0]!.item;
    expect(run.kind === 'tools' && run.calls[0]!.result).toBe('a');
  });

  it('leaves them out of the run summary, failures included', () => {
    const call = (name: string, failed = false): ToolCall => ({ key: name, kind: toolKind(name), name, input: null, result: null, failed, id: null });
    expect(toolRunSummary([call('Bash'), call('Agent', true), call('Workflow', true)], 0)).toBe('Ran 1 command');
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
    // OMP and Codex name their tools in lower case.
    expect(toolRunSummary([call('bash', '{command: ls}'), call('read', '{path: a.ts}'), call('edit', '{path: a.ts}'), call('grep', null)], 0))
      .toBe('Ran 1 command · edited 1 file · read 1 file · searched 1 time');
    expect(toolCallLine(call('read', '{path: src/a.ts}'))).toEqual({ verb: 'Read', detail: 'a.ts' });
    expect(toolRunSummary([call('AskUserQuestion', '{questions: [{question: Pick a color}]}')], 0)).toBe('Asked 1 question');
    expect(toolCallLine(call('AskUserQuestion', '{questions: [{question: Pick a color, header: Color}]}'))).toEqual({ verb: 'Ask', detail: 'Pick a color' });
  });
});
