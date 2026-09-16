import { assistantMeta, parseTranscript, parseTranscriptEntry, parseTranscriptLine } from '../transcript/parser';
import { displayText, isToolOnly } from '../transcript/message';
import { modelDisplayName } from '../transcript/sessionMeta';

const stamp = '2026-09-14T14:00:00.000Z';
function line(type: string, payload: unknown, timestamp = stamp): string {
  return JSON.stringify({ type, timestamp, payload });
}
function message(role: string, text: string, timestamp = stamp): string {
  return line('response_item', { type: 'message', role,
    content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] }, timestamp);
}

describe('Codex rollout history', () => {
  it('renders desktop input and assistant replies without duplicate semantic events', () => {
    const history = [
      line('session_meta', { id: 'session-1', cwd: '/same-folder' }),
      message('developer', 'private instructions'),
      message('user', 'Hello 👋'),
      line('event_msg', { type: 'user_message', message: 'Hello 👋' }),
      line('event_msg', { type: 'agent_message', message: 'Hello!' }),
      line('event_msg', { type: 'item_completed', item: { type: 'agent_message', text: 'Hello!' } }),
      message('assistant', 'Hello!'),
      line('compacted', { message: 'internal compaction instructions' }),
    ].join('\n');
    const messages = parseTranscript(history, 'codex');
    expect(messages.map(displayText)).toEqual(['Hello 👋', 'Hello!']);
    expect(messages.map(item => item.role)).toEqual(['user', 'assistant']);
    expect(messages.every(item => item.agentLabel === 'codex')).toBe(true);
    expect(messages[0]?.timestamp).toBe(Date.parse(stamp));
  });

  it('keeps one-word replies, Markdown, code and multi-part text intact', () => {
    const markdown = '| A | B |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```';
    expect(displayText(parseTranscriptLine(message('assistant', markdown))!)).toBe(markdown);
    expect(displayText(parseTranscriptLine(message('assistant', 'OK'))!)).toBe('OK');
    expect(displayText(parseTranscriptLine(line('response_item', { type: 'message', role: 'user', content: [
      { type: 'input_text', text: 'Look here' }, { type: 'input_image', image_url: 'data:image/png;base64,private' },
    ] }))!)).toBe('Look here\n[Image]');
  });

  it('filters harness-only input and analysis, not normal questions about instructions', () => {
    for (const text of ['# AGENTS.md instructions for /repo\n<INSTRUCTIONS>hidden</INSTRUCTIONS>',
      '<environment_context>private cwd</environment_context>']) {
      expect(parseTranscriptLine(message('user', text))).toBeNull();
    }
    expect(parseTranscriptLine(message('user', 'Explain AGENTS.md please'))).not.toBeNull();
    expect(parseTranscriptLine(line('response_item', { type: 'message', role: 'assistant',
      channel: 'analysis', content: [{ type: 'output_text', text: 'internal reasoning' }] }))).toBeNull();
  });

  it('filters the shared app-server harness blocks without hiding a real prompt beside them', () => {
    const input = (content: unknown[]) => line('response_item', { type: 'message', role: 'user', content });
    const harness = [
      { type: 'input_text', text: '# AGENTS.md instructions\n\n<INSTRUCTIONS>host rules</INSTRUCTIONS>' },
      { type: 'input_text', text: '<environment_context>host details</environment_context>' },
    ];
    expect(parseTranscriptLine(input(harness))).toBeNull();
    expect(displayText(parseTranscriptLine(input([...harness, { type: 'input_text', text: 'Real user prompt' }]))!))
      .toBe('Real user prompt');
  });

  it.each(['function_call', 'custom_tool_call'])('renders %s as tool activity', type => {
    const parsed = parseTranscriptLine(line('response_item', { type, call_id: 'call-1',
      name: 'exec_command', arguments: '{"cmd":"pwd"}', input: 'pwd' }));
    expect(parsed?.segments[0]).toMatchObject({ kind: 'toolUse', name: 'exec_command' });
    expect(isToolOnly(parsed!)).toBe(true);
  });

  it.each(['function_call_output', 'custom_tool_call_output'])('keeps %s out of user bubbles', type => {
    const parsed = parseTranscriptLine(line('response_item', { type, call_id: 'call-1', output: 'test output' }));
    expect(parsed?.segments).toEqual([{ kind: 'toolResult', text: 'test output' }]);
    expect(isToolOnly(parsed!)).toBe(true);
  });

  it('bounds tool input and ignores encrypted reasoning', () => {
    const parsed = parseTranscriptLine(line('response_item', { type: 'custom_tool_call', name: 'apply_patch', input: 'x'.repeat(10_000) }));
    expect(parsed?.segments[0]).toMatchObject({ input: `${'x'.repeat(2_000)}…` });
    expect(parseTranscriptLine(line('response_item', { type: 'reasoning', encrypted_content: 'opaque', summary: [] }))).toBeNull();
    expect(parseTranscriptLine(line('response_item', { type: 'reasoning', summary: [
      { type: 'summary_text', text: 'Checking the tests' },
    ] }))?.segments).toEqual([{ kind: 'thinking', text: 'Checking the tests' }]);
  });

  it('keeps IDs stable on replay and distinguishes a repeated prompt in a later turn', () => {
    const first = message('user', 'again');
    const second = message('user', 'again', '2026-09-14T14:01:00.000Z');
    expect(parseTranscriptLine(first)?.id).toBe(parseTranscriptLine(first)?.id);
    expect(parseTranscriptLine(first)?.id).not.toBe(parseTranscriptLine(second)?.id);
    expect(parseTranscript(first + '\n' + second)).toHaveLength(2);
  });

  it('gets model and last-request input usage without double-counting cache', () => {
    expect(assistantMeta(line('turn_context', { model: 'gpt-5.6', effort: 'high' })))
      .toEqual({ model: 'gpt-5.6', effort: 'high', contextTokens: null });
    for (const effort of [undefined, null, 5, 'high\nprivate text']) {
      expect(assistantMeta(line('turn_context', { model: 'gpt-5.6', effort })))
        .toEqual({ model: 'gpt-5.6', effort: null, contextTokens: null });
    }
    const event = line('event_msg', { type: 'token_count', info: {
      total_token_usage: { input_tokens: 90_000 },
      last_token_usage: { input_tokens: 12_000, cached_input_tokens: 10_000, output_tokens: 300 },
    } });
    expect(parseTranscriptEntry(event)).toEqual({ message: null, meta: { model: null, contextTokens: 12_000 } });
    expect(assistantMeta(line('event_msg', { type: 'token_count', info: null }))).toBeNull();
    expect(modelDisplayName('gpt-5.6')).toBe('gpt-5.6');
    expect(modelDisplayName('o3')).toBe('o3');
    expect(modelDisplayName('claude-opus-4-8')).toBe('Opus 4.8');
  });

  it('ignores unknown and incomplete records without breaking the next line', () => {
    const lines = ['{"type":"response_item","payload":', line('response_item', null),
      line('response_item', { type: 'future_item' }), message('assistant', 'Still here')];
    expect(parseTranscript(lines.join('\n')).map(displayText)).toEqual(['Still here']);
  });
});
