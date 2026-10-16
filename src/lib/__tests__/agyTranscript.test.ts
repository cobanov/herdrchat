import { agentOfIntegration, integrationFor } from '../herdr/agents';
import { agentName } from '../herdr/models';
import { assistantMeta, parseTranscript } from '../transcript/parser';
import { displayText, imagePaths, receiptKey } from '../transcript/message';
import { threadItems, toolKind } from '../threadItems';

const upload = '/home/dev/.cache/herdrchat/uploads/photo.png';

/** One line of agy's `transcript.jsonl`, in the shape agy 1.3.6 writes. */
function step(index: number, type: string, fields: Record<string, unknown>): string {
  return JSON.stringify({
    step_index: index,
    source: type === 'USER_INPUT' ? 'USER_EXPLICIT' : 'MODEL',
    type,
    status: 'DONE',
    created_at: `2026-10-15T23:26:${String(40 + index).padStart(2, '0')}Z`,
    ...fields,
  });
}

const prompt = (index: number, typed: string, extra = '') => step(index, 'USER_INPUT', {
  content: `<USER_REQUEST>\n${typed}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-10-16T02:26:46+03:00.\n</ADDITIONAL_METADATA>${extra}`,
});

const history = [
  prompt(0, `Merhaba 👋\n${upload}`, '\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 3.8 Flash (High). No need to comment on this change if the user doesn\'t ask about it.\n</USER_SETTINGS_CHANGE>'),
  step(1, 'PLANNER_RESPONSE', {
    input_tokens: 11_831, cache_read_tokens: 0, output_tokens: 473,
    thinking: 'Checking the folder first.',
    tool_calls: [{
      name: 'run_command',
      args: {
        CommandLine: '"ls -la docs"', Cwd: '"/home/dev/app"', IsDaemon: 'false', WaitMsBeforeAsync: '5000',
        toolAction: '"Listing the docs"', toolSummary: '"List docs"',
      },
    }],
  }),
  step(2, 'GENERIC', {
    content: 'Created At: 2026-10-16T02:26:54+03:00\nCompleted At: 2026-10-16T02:27:10+03:00\n\nThe command exited with code 0.\nOutput:\nREADME.md\r\nsetup.md\r\n\n',
  }),
  step(3, 'PLANNER_RESPONSE', {
    input_tokens: 2_791, cache_read_tokens: 18_559, output_tokens: 1_002,
    content: '**Yes**, the docs are there.',
    thinking: 'The listing answers it.',
  }),
].join('\n');

describe('Antigravity transcript', () => {
  it('reads a turn: the prompt, thinking and a tool call, its output, the reply', () => {
    const messages = parseTranscript(history, 'agy');
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(messages.every((message) => message.agentLabel === 'agy')).toBe(true);
    expect(new Set(messages.map((message) => message.id)).size).toBe(4);
    expect(messages[0]?.timestamp).toBe(Date.parse('2026-10-15T23:26:40Z'));
    // Only what was typed: the echo of a sent message is matched by its text and picture count.
    expect(displayText(messages[0]!)).toBe('Merhaba 👋');
    expect(imagePaths(messages[0]!)).toEqual([upload]);
    expect(receiptKey(messages[0]!)).toBe('Merhaba 👋\u00001');
    expect(messages[1]?.segments).toEqual([
      { kind: 'thinking', text: 'Checking the folder first.' },
      {
        kind: 'toolUse', name: 'run_command',
        input: '{"command":"ls -la docs","cwd":"/home/dev/app","IsDaemon":false,"WaitMsBeforeAsync":5000,"description":"List docs"}',
        id: 'agy-1:0',
      },
    ]);
    expect(messages[2]?.segments).toEqual([
      { kind: 'toolResult', text: 'The command exited with code 0.\nOutput:\nREADME.md\nsetup.md', toolUseId: 'agy-1:0' },
    ]);
    expect(messages[3]?.segments).toEqual([
      { kind: 'thinking', text: 'The listing answers it.' },
      { kind: 'text', text: '**Yes**, the docs are there.' },
    ]);
  });

  it('folds the call with its output, as a command the thread can show', () => {
    expect(toolKind('run_command')).toBe('command');
    expect(toolKind('view_file')).toBe('read');
    expect(toolKind('search_web')).toBe('search');
    const run = threadItems(parseTranscript(history, null), { showSidechain: false })
      .map((placed) => placed.item)
      .find((item) => item.kind === 'tools');
    expect(run?.kind === 'tools' ? run.calls.map((call) => [call.name, call.result]) : null)
      .toEqual([['run_command', 'The command exited with code 0.\nOutput:\nREADME.md\nsetup.md']]);
  });

  // Seen in a real conversation: a call was interrupted ("continue" typed
  // over it) and never got an output. Paired by order, every later output went
  // to the call before its own.
  it('gives each output to the call in the step before it, past an interrupted call', () => {
    const call = (index: number, command: string) => step(index, 'PLANNER_RESPONSE', {
      input_tokens: 100, tool_calls: [{ name: 'run_command', args: { CommandLine: JSON.stringify(command) } }],
    });
    const output = (index: number, text: string) => step(index, 'GENERIC', { content: `Created At: x\nCompleted At: y\n\n${text}` });
    const lines = [call(5, 'sleep 60'), prompt(7, 'continue'), call(8, 'ls'), output(9, 'README.md')].join('\n');
    const calls = threadItems(parseTranscript(lines, null), { showSidechain: false })
      .flatMap((placed) => (placed.item.kind === 'tools' ? placed.item.calls : []));
    expect(calls.map((item) => item.result)).toEqual([null, 'README.md']);
  });

  it('gives the header the model a prompt switched to, and the context of each turn', () => {
    const lines = history.split('\n');
    expect(assistantMeta(lines[0]!)).toEqual({ model: 'Gemini 3.8 Flash (High)', contextTokens: null });
    expect(assistantMeta(lines[3]!)).toEqual({ model: null, contextTokens: 21_350 });
    // A prompt that changes nothing says nothing of the model.
    expect(assistantMeta(prompt(4, 'continue'))).toBeNull();
  });

  it('leaves lines of other agents alone', () => {
    expect(parseTranscript(JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' }, uuid: 'u1' }), null)
      .every((message) => !message.id.startsWith('agy:'))).toBe(true);
  });

  // herdr calls the agent `agy` and its integration `antigravity-cli`.
  it('names the agent and installs its integration under their own names', () => {
    expect(agentName('agy')).toBe('Antigravity');
    expect(integrationFor('agy')).toBe('antigravity-cli');
    expect(agentOfIntegration('antigravity-cli')).toBe('agy');
    expect(agentOfIntegration('grok')).toBe('grok');
  });
});
