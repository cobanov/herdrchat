import { claudeUserText, codexAssistantText, codexUserText } from '../transcript/harness';
import { codexEntry } from '../transcript/codex';
import { displayText } from '../transcript/message';
import { assistantMeta, parseTranscript, parseTranscriptLine } from '../transcript/parser';
import { modelDisplayName } from '../transcript/sessionMeta';

/** Synthetic lines in the shapes Claude Code 2.1.270-2.1.280 writes. */
const user = (content: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-09-23T10:00:00Z', message: { role: 'user', content }, ...extra });
const assistant = (text: string, model = 'claude-opus-5-5', usage: Record<string, number> = { input_tokens: 10 }) =>
  JSON.stringify({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', model, usage, content: [{ type: 'text', text }] } });

describe('queued prompts (#77)', () => {
  const queued = (prompt: unknown, commandMode = 'prompt') =>
    JSON.stringify({
      type: 'attachment',
      uuid: 'q1',
      timestamp: '2026-09-23T10:01:00Z',
      attachment: { type: 'queued_command', commandMode, prompt, origin: { kind: 'human' } },
    });

  it('shows a prompt sent while the agent was busy as the user message it is', () => {
    const message = parseTranscriptLine(queued('run the tests again'));
    expect(message).toMatchObject({ id: 'q1', role: 'user' });
    // The same text the phone sent, so the optimistic echo can be matched.
    expect(displayText(message!)).toBe('run the tests again');
    expect(message!.timestamp).toBe(Date.parse('2026-09-23T10:01:00Z'));
  });

  it('reads a prompt given as content blocks', () => {
    const message = parseTranscriptLine(queued([{ type: 'text', text: 'look at this' }, { type: 'image', source: {} }]));
    expect(displayText(message!)).toBe('look at this');
  });

  it("keeps the harness's own queued task notifications hidden", () => {
    expect(parseTranscriptLine(queued('<task-notification>…</task-notification>', 'task-notification'))).toBeNull();
  });

  it('ignores other attachments', () => {
    expect(parseTranscriptLine(JSON.stringify({ type: 'attachment', attachment: { type: 'file', path: 'a.ts' } }))).toBeNull();
  });
});

describe('Claude harness lines (#78)', () => {
  it.each([
    ['isMeta', { isMeta: true }],
    ['promptSource system', { promptSource: 'system' }],
    ['a task-notification origin', { origin: { kind: 'task-notification' } }],
    ['a peer origin', { origin: { kind: 'peer' } }],
    ['a compact summary', { isCompactSummary: true }],
  ])('hides a user line marked by %s', (_name, extra) => {
    expect(parseTranscriptLine(user('Looks like something the user typed', extra))).toBeNull();
  });

  it('keeps a line the user typed', () => {
    const message = parseTranscriptLine(user('fix the build', { promptSource: 'typed', origin: { kind: 'human' } }));
    expect(displayText(message!)).toBe('fix the build');
  });

  it.each([
    ['<task-notification>\n<task-id>x</task-id>\n</task-notification>'],
    ['<local-command-stdout>Set model to Opus</local-command-stdout>'],
    ['<local-command-caveat>Caveat: …</local-command-caveat>'],
    ['<bash-stdout>total 8</bash-stdout><bash-stderr></bash-stderr>'],
    ['<system-reminder>stay on task</system-reminder>'],
  ])('hides a turn that is only a harness element: %s', (text) => {
    expect(parseTranscriptLine(user(text))).toBeNull();
    expect(parseTranscriptLine(user([{ type: 'text', text }]))).toBeNull();
  });

  it('shows a slash command as what was typed', () => {
    const command = '<command-message>model</command-message>\n<command-name>/model</command-name>\n<command-args></command-args>';
    expect(claudeUserText(command)).toBe('/model');
    expect(claudeUserText('<command-name>/review</command-name><command-args> 42 </command-args>')).toBe('/review 42');
  });

  it('shows shell mode as a ! command', () => {
    expect(claudeUserText('<bash-input>ls -la</bash-input>')).toBe('! ls -la');
  });

  it('leaves ordinary markup a person typed alone', () => {
    expect(claudeUserText('<div>hello</div>')).toBe('<div>hello</div>');
  });

  it('keeps the chat preview on the last real message when a notification lands after it', () => {
    const transcript = [assistant('All green.'), user('<task-notification>done</task-notification>', { promptSource: 'system' })].join('\n');
    const messages = parseTranscript(transcript);
    expect(messages.at(-1)?.role).toBe('assistant');
  });
});

describe('pasted content (#79)', () => {
  it('unwraps a long paste', () => {
    const text = '<pasted_content id="980d">\nline one\nline two\n</pasted_content id="980d">';
    expect(claudeUserText(text)).toBe('line one\nline two');
  });

  it('keeps text typed after the paste', () => {
    const text = '<pasted_content id="a8b4">\nstack trace\n</pasted_content id="a8b4">\n\nwhat is this?';
    expect(claudeUserText(text)).toBe('stack trace\n\nwhat is this?');
  });

  it('matches the text the phone sent, so its echo reconciles', () => {
    const sent = 'first line\nsecond line\nthird line';
    const line = user(`<pasted_content id="1">\n${sent}\n</pasted_content id="1">`, { promptSource: 'typed' });
    expect(displayText(parseTranscriptLine(line)!).trim()).toBe(sent);
  });
});

describe('synthetic lines and model names (#80)', () => {
  const zero = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

  it('does not let an API-error line set the header model or context', () => {
    expect(assistantMeta(assistant('API Error: Rate limit reached', '<synthetic>', zero))).toBeNull();
    const flagged = JSON.stringify({ ...JSON.parse(assistant('Login expired')), isApiErrorMessage: true });
    expect(assistantMeta(flagged)).toBeNull();
  });

  it('still shows the error text itself', () => {
    expect(displayText(parseTranscriptLine(assistant('API Error: Rate limit reached', '<synthetic>', zero))!)).toContain('Rate limit');
  });

  it.each([
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-opus-5-5[1m]', 'Opus 5.5'],
    ['claude-sonnet-5', 'Sonnet 5'],
    ['claude-fable-5-1', 'Fable 5.1'],
    ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
    ['claude-3-5-sonnet-20241022', 'Sonnet 3.5'],
    ['claude-3-opus-20240229', 'Opus 3'],
    ['gpt-5.5-codex', 'gpt-5.5-codex'],
  ])('names %s as %s', (id, name) => {
    expect(modelDisplayName(id)).toBe(name);
  });
});

describe('Codex harness text (#78)', () => {
  it.each([
    ['<heartbeat>tick</heartbeat>'],
    ['<recommended_plugins>…</recommended_plugins>'],
    ['<codex_internal_context>…</codex_internal_context>'],
    ['<environment_context>\n<cwd>/x</cwd>\n</environment_context>'],
    ['# AGENTS.md instructions for /x\n\nbe nice'],
  ])('hides %s', (text) => {
    expect(codexUserText(text)).toBeNull();
  });

  it('keeps the prompt typed after an injected context element', () => {
    const text = '<in-app-browser-context source="ambient-ui-state">page</in-app-browser-context>\nwhy is this red?';
    expect(codexUserText(text)).toBe('why is this red?');
  });

  it('drops an image reference and keeps the text beside it', () => {
    expect(codexUserText('<image name=[Image #1] path="/tmp/codex-clipboard-1.png">')).toBeNull();
    expect(codexUserText('<image name=[Image #1] path="/tmp/a.png"></image> what is this')).toBe('what is this');
  });

  it('shows the answer inside a question reply', () => {
    expect(codexUserText('<send_user_message_question_reply>Use Postgres</send_user_message_question_reply>')).toBe('Use Postgres');
  });

  it('renders none of it as a bubble through the transcript parser', () => {
    const line = JSON.stringify({
      type: 'response_item',
      timestamp: '2026-09-23T10:00:00Z',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<heartbeat>tick</heartbeat>' }] },
    });
    expect(parseTranscriptLine(line)).toBeNull();
  });
});

// Seen in Codex 0.154 replies with memories on: a footnote block for Codex's own
// UI, which read as a pile of MEMORY.md line ranges under every answer.
describe('Codex memory citations', () => {
  const CITED = [
    'Updated the project note with today\'s results.',
    '',
    '<oai-mem-citation>',
    '<citation_entries>',
    'MEMORY.md:627-640|note=[issue acceptance rules]',
    '</citation_entries>',
    '<rollout_ids>',
    '01a077ec-f777-70e3-a531-22b668ed1e9e',
    '</rollout_ids>',
    '</oai-mem-citation>',
  ].join('\n');

  it('keeps the answer and drops the citation block', () => {
    expect(codexAssistantText(CITED)).toBe("Updated the project note with today's results.");
    expect(codexAssistantText('No citations here.\n')).toBe('No citations here.');
    expect(codexAssistantText('Cut off.\n<oai-mem-citation>\n<citation_entries>\nMEMORY.md:1-2')).toBe('Cut off.');
  });

  it('applies to the assistant messages read from a rollout', () => {
    const { message } = codexEntry({
      type: 'response_item',
      timestamp: '2026-09-20T12:25:29Z',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: CITED }] },
    }, 'hash', null);
    expect(message === null ? null : displayText(message)).toBe("Updated the project note with today's results.");
  });
});
