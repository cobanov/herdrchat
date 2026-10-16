import { agentSpec } from '../herdr/agents';
import { agentName } from '../herdr/models';
import type { HerdrTransport } from '../herdr/transport';
import { displayText, imagePaths, receiptKey } from '../transcript/message';
import { assistantMeta, parseTranscript, parseTranscriptLine } from '../transcript/parser';
import { TranscriptStore } from '../transcript/store';
import { threadItems, toolKind } from '../threadItems';

const upload = '/home/dev/.cache/herdrchat/uploads/photo.png';
const log = '/home/dev/.gemini/tmp/app/chats/session-2026-10-16T09-00-1a2b3c4d.jsonl';

/** One message line of Gemini CLI's session log, in the shape 0.64 writes. */
const message = (id: string, type: string, fields: Record<string, unknown>) =>
  JSON.stringify({ id, timestamp: '2026-10-16T09:00:10.000Z', type, ...fields });

const call = {
  id: 'run_shell_command_1',
  name: 'run_shell_command',
  args: { command: 'ls docs', description: 'List docs' },
  timestamp: '2026-10-16T09:00:14.000Z',
};
const reply = {
  content: 'Checking the folder.',
  thoughts: [{ subject: 'Looking', description: 'The docs folder first.', timestamp: '2026-10-16T09:00:12.000Z' }],
  model: 'gemini-3-pro-preview',
};
const result = [{ functionResponse: { id: call.id, name: call.name, response: {
  output: '<untrusted_context>\nOutput: README.md\nsetup.md\n</untrusted_context>',
} } }];

const history = [
  JSON.stringify({ sessionId: '1a2b3c4d-0000', projectHash: 'abc', startTime: 'x', lastUpdated: 'x', kind: 'main' }),
  message('env', 'user', { content: [{ text: '<session_context>\nThis is the Gemini CLI.\n</session_context>' }] }),
  // Gemini sent the model the file an @ named; what was typed is displayContent.
  message('u1', 'user', {
    content: [{ text: 'Merhaba 👋 @notes.md\n--- notes.md ---\nsecret' }],
    displayContent: [{ text: `Merhaba 👋 @notes.md\n${upload}` }],
  }),
  JSON.stringify({ $set: { lastUpdated: 'x' } }),
  message('a1', 'gemini', reply),
  // The same message again, once its call is done.
  message('a1', 'gemini', { ...reply, tokens: { input: 12_000, output: 40, cached: 8_000, thoughts: 10, tool: 0, total: 12_050 },
    toolCalls: [{ ...call, result, status: 'success' }] }),
  // The answer Gemini sends the model, and its own notices: no one's message.
  message('u2', 'user', { content: result }),
  message('i1', 'info', { content: 'Request cancelled.' }),
  message('a2', 'gemini', { content: [{ text: 'thinking aloud', thought: true }, { text: '**Yes**, both are there.' }] }),
].join('\n');

describe('Gemini CLI transcript', () => {
  it('reads a turn: the prompt as typed, thoughts, reply and a call with its result, the next reply', () => {
    const messages = parseTranscript(history, 'gemini');
    expect(messages.map((read) => [read.id, read.role])).toEqual([
      ['gemini:u1', 'user'], ['gemini:a1', 'assistant'], ['gemini:a2', 'assistant'],
    ]);
    expect(messages.every((read) => read.agentLabel === 'gemini')).toBe(true);
    expect(messages[0]?.timestamp).toBe(Date.parse('2026-10-16T09:00:10.000Z'));
    // Only what was typed: the echo of a sent message is matched by its text and picture count.
    expect(displayText(messages[0]!)).toBe('Merhaba 👋 @notes.md');
    expect(imagePaths(messages[0]!)).toEqual([upload]);
    expect(receiptKey(messages[0]!)).toBe('Merhaba 👋 @notes.md\u00001');
    // The later line of a1 replaced the first, where the first was.
    expect(messages[1]?.segments).toEqual([
      { kind: 'thinking', text: 'Looking: The docs folder first.' },
      { kind: 'text', text: 'Checking the folder.' },
      { kind: 'toolUse', name: 'run_shell_command', input: '{command: ls docs, description: List docs}', id: 'gemini-run_shell_command_1' },
      { kind: 'toolResult', text: 'Output: README.md\nsetup.md', toolUseId: 'gemini-run_shell_command_1' },
    ]);
    expect(displayText(messages[2]!)).toBe('**Yes**, both are there.');
  });

  it('folds the call with its result, and marks a failed or cancelled one', () => {
    expect(['run_shell_command', 'read_file', 'replace', 'write_file', 'grep_search', 'google_web_search', 'web_fetch', 'write_todos'].map(toolKind))
      .toEqual(['command', 'read', 'edit', 'edit', 'search', 'search', 'fetch', 'todo']);
    const failed = message('a3', 'gemini', { content: '', toolCalls: [{ ...call, result: [{ functionResponse: { response: { error: 'denied' } } }], status: 'cancelled' }] });
    const calls = threadItems(parseTranscript(`${history}\n${failed}`, null), { showSidechain: false })
      .flatMap((placed) => (placed.item.kind === 'tools' ? placed.item.calls : []));
    expect(calls.map((item) => [item.name, item.result, item.failed])).toEqual([
      ['run_shell_command', 'Output: README.md\nsetup.md', false],
      ['run_shell_command', 'denied', true],
    ]);
    // A call still running has no result yet, and waits for its message to come again.
    expect(parseTranscriptLine(message('a4', 'gemini', { content: '', toolCalls: [call] }))?.segments.map((segment) => segment.kind))
      .toEqual(['toolUse']);
  });

  it('gives the header the model and the prompt size, which already holds the cached part', () => {
    const lines = history.split('\n');
    expect(assistantMeta(lines[4]!)).toEqual({ model: 'gemini-3-pro-preview', contextTokens: null });
    expect(assistantMeta(lines[5]!)).toEqual({ model: 'gemini-3-pro-preview', contextTokens: 12_000 });
    expect(assistantMeta(lines[2]!)).toBeNull();
  });

  // shortcut in gemini.ts: a rewind or a patch is read as nothing until the thread can remove a message.
  it('reads the records about the session as no message, and leaves other agents alone', () => {
    for (const line of [
      JSON.stringify({ $rewindTo: 'a1' }),
      JSON.stringify({ $patch: { updates: [{ id: 'a1', content: 'x' }] } }),
      JSON.stringify({ $set: { messages: [] } }),
    ]) expect(parseTranscriptLine(line)).toBeNull();
    const claude = JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' }, uuid: 'u1' });
    expect(parseTranscriptLine(claude)?.id).toBe('u1');
  });

  // The hook reports the log's path; the app opens that file and no other.
  it('opens only a reported path in the shape of a Gemini session log', () => {
    const transport: HerdrTransport = { exec: async () => ({ ok: true, stdout: '', stderr: '', exitCode: 0 }), streamLines: async function* () {} };
    const store = new TranscriptStore(transport);
    expect(store.geminiTranscriptPath(log, 'path')).toBe(log);
    for (const bad of [
      'relative/.gemini/tmp/app/chats/session-1.jsonl',
      '/home/dev/.gemini/tmp/app/chats/1a2b3c4d/sub-agent.jsonl',
      '/home/dev/.gemini/tmp/app/../../x/chats/session-1.jsonl',
      '/home/dev/.gemini/tmp/app/chats/session-1.json',
      `${log}\n`,
      '/home/dev/notes/session-1.jsonl',
    ]) expect(store.geminiTranscriptPath(bad, 'path')).toBeNull();
    // An id names no file: Gemini names it by the minute it started too.
    expect(store.geminiTranscriptPath('1a2b3c4d-0000', 'id')).toBeNull();
  });

  // herdr 0.9.5 keeps no session reported for Gemini, from any source, so a
  // hook that reported one changed the person's settings for nothing.
  it('names the agent and offers nothing to install, since herdr has no integration for it', () => {
    expect(agentName('gemini')).toBe('Gemini');
    expect(agentSpec('gemini')).toEqual(expect.objectContaining({ reader: 'gemini', integration: null }));
    expect(agentSpec('gemini')).not.toHaveProperty('installHook');
  });
});
