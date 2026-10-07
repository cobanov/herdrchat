import { assistantMeta, parseTranscript, parseTranscriptEntry, parseTranscriptLine } from '../transcript/parser';
import { displayText, imagePaths, isToolOnly, receiptKey } from '../transcript/message';

const entryTimestamp = '2026-09-28T12:00:00.000Z';
const upload = '/home/dev/.cache/herdrchat/uploads/photo.png';

function journal(type: string, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ type, id: `entry-${type}`, parentId: null, timestamp: entryTimestamp, ...fields });
}

describe('OMP journal transcript', () => {
  it('renders chronological persisted messages without Claude input cleanup', () => {
    const history = [
      JSON.stringify({ type: 'session', version: 3, id: 'session-1', timestamp: entryTimestamp, cwd: '/repo' }),
      journal('message', { id: 'user-1', message: {
        role: 'user', timestamp: 1_790_694_400_000,
        content: `# AGENTS.md instructions\nMerhaba 👋\n\n${upload}`,
      } }),
      journal('message', { id: 'assistant-1', message: {
        role: 'assistant', timestamp: 1_790_694_401_000, model: 'openai/gpt-5.6',
        contextSnapshot: { promptTokens: 12_345 },
        content: [
          { type: 'thinking', thinking: 'Checking the Unicode input.' },
          { type: 'text', text: 'Merhaba! ✅' },
          { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'src/index.ts' } },
        ],
      } }),
      journal('message', { id: 'tool-1', message: {
        role: 'toolResult', timestamp: 1_790_694_402_000,
        content: [{ type: 'text', text: `${upload}\nnot a user receipt` }],
      } }),
    ].join('\n');

    const messages = parseTranscript(history, 'omp');
    expect(messages.map(message => message.id)).toEqual(['omp:user-1', 'omp:assistant-1', 'omp:tool-1']);
    expect(messages.map(message => message.timestamp)).toEqual([1_790_694_400_000, 1_790_694_401_000, 1_790_694_402_000]);
    expect(messages.every(message => message.agentLabel === 'omp')).toBe(true);
    expect(displayText(messages[0]!)).toBe('# AGENTS.md instructions\nMerhaba 👋');
    expect(imagePaths(messages[0]!)).toEqual([upload]);
    expect(receiptKey(messages[0]!)).toBe('# AGENTS.md instructions\nMerhaba 👋\u00001');
    expect(messages[1]?.segments.map(segment => segment.kind)).toEqual(['thinking', 'text', 'toolUse']);
    expect(messages[2]?.segments).toEqual([{ kind: 'toolResult', text: `${upload}\nnot a user receipt` }]);
    expect(isToolOnly(messages[2]!)).toBe(true);
  });

  it('pairs a result with its call and keeps its failure', () => {
    const call = parseTranscriptLine(journal('message', { id: 'a', message: {
      role: 'assistant', content: [{ type: 'toolCall', id: 'call-7', name: 'bash', arguments: { command: 'npm test' } }],
    } }));
    const result = parseTranscriptLine(journal('message', { id: 'r', message: {
      role: 'toolResult', toolCallId: 'call-7', toolName: 'bash', isError: true, content: [{ type: 'text', text: '1 failed' }],
    } }));
    expect(call?.segments[0]).toMatchObject({ kind: 'toolUse', name: 'bash', id: 'call-7' });
    expect(result?.segments).toEqual([{ kind: 'toolResult', text: '1 failed', toolUseId: 'call-7', isError: true }]);
  });

  it('uses entry ids across replays and falls back to the journal timestamp', () => {
    const line = journal('message', { id: 'stable-id', message: {
      role: 'assistant', content: [{ type: 'text', text: 'Done' }],
    } });
    expect(parseTranscriptLine(line)?.id).toBe('omp:stable-id');
    expect(parseTranscriptLine(line)?.id).toBe(parseTranscriptLine(line)?.id);
    expect(parseTranscriptLine(line)?.timestamp).toBe(Date.parse(entryTimestamp));
  });

  it('reports assistant model and real context usage without creating zero usage', () => {
    const assistant = journal('message', { message: {
      role: 'assistant', model: 'anthropic/claude-sonnet-5', content: [],
      usage: { input: 100, cacheRead: 2_000, cacheWrite: 40 },
    } });
    expect(parseTranscriptEntry(assistant)).toEqual({
      message: null,
      meta: { model: 'anthropic/claude-sonnet-5', contextTokens: 2_140 },
    });
    expect(assistantMeta(journal('message', { message: {
      role: 'assistant', model: 'openai/gpt-5.6', content: [], usage: { output: 12 },
    } }))).toEqual({ model: 'openai/gpt-5.6', contextTokens: null });
  });

  it('reports model and thinking changes as metadata without resetting effort', () => {
    expect(assistantMeta(journal('model_change', { model: 'openai/gpt-5.6', role: 'default' })))
      .toEqual({ model: 'openai/gpt-5.6', contextTokens: null });
    expect(assistantMeta(journal('model_change', { provider: 'anthropic', modelId: 'claude-opus-4-5' })))
      .toEqual({ model: 'claude-opus-4-5', contextTokens: null });
    expect(assistantMeta(journal('thinking_level_change', { thinkingLevel: 'low', configured: 'auto' })))
      .toEqual({ model: null, effort: 'low', contextTokens: null });
    expect(assistantMeta(journal('thinking_level_change', { thinkingLevel: null, configured: null })))
      .toEqual({ model: null, effort: null, contextTokens: null });
  });

  it('keeps opaque image data as an image marker and never invents blob contents', () => {
    const parsed = parseTranscriptLine(journal('message', { message: {
      role: 'user', timestamp: 1, content: [
        { type: 'text', text: 'Look at this' },
        { type: 'image', data: 'blob:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', mimeType: 'image/png' },
      ],
    } }))!;
    expect(displayText(parsed)).toBe('Look at this');
    expect(parsed.segments).toContainEqual({ kind: 'image', path: '' });
    expect(receiptKey(parsed)).toBe('Look at this\u00001');
  });

  it('shows persisted branch, compaction and reset journal boundaries in file order', () => {
    const history = [
      journal('message', { id: 'before', message: { role: 'user', timestamp: 1, content: 'Before branch' } }),
      journal('branch_summary', { id: 'branch', summary: 'Kept the implementation approach.' }),
      journal('compaction', { id: 'compact', summary: 'Model-facing context.', firstKeptEntryId: 'branch', tokensBefore: 180000 }),
      journal('reset_boundary', { id: 'reset' }),
      journal('message', { id: 'after', message: { role: 'user', timestamp: 2, content: 'After reset' } }),
    ].join('\n');
    const messages = parseTranscript(history);
    expect(messages.map(message => message.role)).toEqual(['user', 'system', 'system', 'system', 'user']);
    expect(messages.map(displayText)).toEqual([
      'Before branch',
      'Branch summary (journal entry)\n\nKept the implementation approach.',
      'Context compacted (journal entry)',
      'Context reset (journal entry)',
      'After reset',
    ]);
  });

  it('skips malformed, custom, and incomplete records without losing later history', () => {
    const history = [
      '{"type":"message","message":',
      journal('custom', { customType: 'private-extension', data: { secret: 'not conversation' } }),
      journal('message', { message: { role: 'assistant', content: [{ type: 'redactedThinking', data: 'opaque' }] } }),
      journal('message', { id: 'good', message: { role: 'assistant', timestamp: 3, content: [{ type: 'text', text: 'Still here' }] } }),
    ].join('\n');
    expect(parseTranscript(history).map(displayText)).toEqual(['Still here']);
  });
});
