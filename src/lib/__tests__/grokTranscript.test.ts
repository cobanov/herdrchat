import { assistantMeta, parseTranscript } from '../transcript/parser';
import { displayText, imagePaths, receiptKey } from '../transcript/message';
import { toolKind } from '../threadItems';

const upload = '/home/dev/.cache/herdrchat/uploads/photo.png';
let event = 0;

/** One line of Grok's `updates.jsonl`: an ACP `session/update`, as Grok 1.0.52 writes it. */
function update(fields: Record<string, unknown>, method = 'session/update'): string {
  event += 1;
  return JSON.stringify({
    timestamp: 1_792_073_586,
    method,
    params: {
      sessionId: '01a13fe8-d5b9-7b90-90e5-c2cda57be3af',
      update: fields,
      _meta: { eventId: `ev-${event}`, agentTimestampMs: 1_792_073_586_000 + event },
    },
  });
}

describe('Grok ACP transcript', () => {
  it('reads a turn: the prompt, thinking, a reply, a tool call and its result', () => {
    const history = [
      update({
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: `Merhaba 👋\n${upload}` },
        _meta: { modelId: 'grok-5', promptIndex: 0 },
      }),
      update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Checking.' } }),
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Running the tests.' } }),
      update({
        sessionUpdate: 'tool_call', toolCallId: 'call-1', title: 'Run npm test',
        rawInput: { command: 'npm test' },
        _meta: { 'x.ai/tool': { name: 'run_terminal_command', kind: 'execute' } },
      }),
      // Progress before the result is not a bubble of its own.
      update({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', content: [] }),
      update({
        sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'failed',
        content: [{ type: 'content', content: { type: 'text', text: '1 failing' } }],
      }),
      update({ sessionUpdate: 'turn_completed', stop_reason: 'end_turn' }, '_x.ai/session/update'),
    ].join('\n');

    const messages = parseTranscript(history, 'grok');
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'assistant', 'assistant', 'user']);
    expect(messages.every((message) => message.agentLabel === 'grok')).toBe(true);
    expect(new Set(messages.map((message) => message.id)).size).toBe(5);
    expect(messages[0]?.timestamp).toBe(1_792_073_586_000 + event - 6);
    // The echo of a sent message is matched by its text and picture count.
    expect(displayText(messages[0]!)).toBe('Merhaba 👋');
    expect(imagePaths(messages[0]!)).toEqual([upload]);
    expect(receiptKey(messages[0]!)).toBe('Merhaba 👋\u00001');
    expect(messages[1]?.segments).toEqual([{ kind: 'thinking', text: 'Checking.' }]);
    expect(messages[3]?.segments).toEqual([
      { kind: 'toolUse', name: 'run_terminal_command', input: '{"command":"npm test"}', id: 'call-1' },
    ]);
    expect(messages[4]?.segments).toEqual([{ kind: 'toolResult', text: '1 failing', toolUseId: 'call-1', isError: true }]);
  });

  it('hides the prompts Grok writes for itself', () => {
    const woken = update({
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'Background task finished.' },
      _meta: { modelId: 'grok-5', promptIndex: 3, syntheticPrompt: true, hideFromScrollback: true },
    });
    expect(parseTranscript(woken)).toEqual([]);
  });

  it('names the model from the prompt, for the header', () => {
    const prompt = update({
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'hi' },
      _meta: { modelId: 'grok-5', promptIndex: 0 },
    });
    expect(assistantMeta(prompt)).toEqual({ model: 'grok-5', contextTokens: null });
  });

  // Grok's own tool names, so a run reads "ran a command" rather than "called a tool".
  it('folds its tools by what they do', () => {
    expect(['run_terminal_command', 'read_file', 'search_replace', 'grep', 'list_dir', 'web_fetch', 'use_tool'].map(toolKind))
      .toEqual(['command', 'read', 'edit', 'search', 'search', 'fetch', 'tool']);
  });

  it('shows an edit by its file', () => {
    const edit = update({
      sessionUpdate: 'tool_call_update', toolCallId: 'call-2', status: 'completed',
      content: [{ type: 'diff', path: '/repo/src/index.ts', oldText: 'a', newText: 'b' }],
    });
    expect(parseTranscript(edit)[0]?.segments).toEqual([
      { kind: 'toolResult', text: 'Edited /repo/src/index.ts', toolUseId: 'call-2' },
    ]);
  });
});
