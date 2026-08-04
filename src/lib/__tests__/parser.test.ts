import { readFileSync } from 'fs';
import { join } from 'path';

import { displayText, isToolOnly } from '../transcript/message';
import {
  assistantMeta,
  parseTranscript,
  parseTranscriptEntry,
  parseTranscriptLine,
  projectDirName,
} from '../transcript/parser';
import { contextLabel, modelDisplayName } from '../transcript/sessionMeta';

const transcript = readFileSync(join(__dirname, 'fixtures/transcript.jsonl'), 'utf8');

describe('transcript parsing', () => {
  const messages = parseTranscript(transcript);

  it('keeps only conversational turns', () => {
    // The fixture has a mode line and an attachment line; neither is a bubble.
    expect(messages.map((message) => message.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'sc1']);
  });

  it('orders a turn’s parts as segments', () => {
    const assistant = messages.find((message) => message.id === 'a1');
    expect(assistant?.segments.map((segment) => segment.kind)).toEqual([
      'thinking',
      'text',
      'toolUse',
    ]);
    expect(displayText(assistant!)).toBe('Tamam, testleri calistiriyorum.');
  });

  it('summarises a tool call for the chip', () => {
    const assistant = messages.find((message) => message.id === 'a1');
    const toolUse = assistant?.segments.find((segment) => segment.kind === 'toolUse');
    expect(toolUse).toMatchObject({ name: 'Bash' });
    expect(toolUse?.kind === 'toolUse' ? toolUse.input : '').toContain('swift test');
  });

  // A tool result arrives as a "user" turn. Showing it as something the user
  // typed would be wrong, so the thread needs to be able to spot it.
  it('marks a tool-result turn as carrying no user text', () => {
    const toolResult = messages.find((message) => message.id === 'u2');
    expect(toolResult?.role).toBe('user');
    expect(isToolOnly(toolResult!)).toBe(true);
  });

  it('flags sidechain chatter so the UI can hide it', () => {
    expect(messages.find((message) => message.id === 'sc1')?.isSidechain).toBe(true);
    expect(messages.find((message) => message.id === 'a2')?.isSidechain).toBe(false);
  });

  it('parses timestamps', () => {
    const first = messages.find((message) => message.id === 'u1');
    expect(first?.timestamp).toBe(Date.parse('2026-07-16T16:22:32.273Z'));
  });

  it('stamps an agent label when asked', () => {
    const labelled = parseTranscript(transcript, 'claude');
    expect(labelled.every((message) => message.agentLabel === 'claude')).toBe(true);
  });
});

describe('single-line parsing', () => {
  // A tail can hand us half a line at any moment. Returning null is the contract
  // the whole streaming path depends on.
  it('returns null for a truncated or non-JSON line', () => {
    expect(parseTranscriptLine('{"type":"user","uuid":"u1","mess')).toBeNull();
    expect(parseTranscriptLine('')).toBeNull();
    expect(parseTranscriptLine('not json at all')).toBeNull();
  });

  it('returns null for entries that are not turns', () => {
    expect(parseTranscriptLine('{"type":"mode","mode":"default"}')).toBeNull();
    expect(parseTranscriptLine('{"type":"summary","summary":"x"}')).toBeNull();
  });

  it('returns null for a turn with no renderable segments', () => {
    expect(
      parseTranscriptLine('{"type":"user","uuid":"u9","message":{"role":"user","content":"   "}}')
    ).toBeNull();
  });

  // Without a uuid the id must still be stable across reloads, or dedupe fails
  // and the same turn re-appends every time a thread resumes.
  it('derives a stable id when the turn has no uuid', () => {
    const line = '{"type":"user","message":{"role":"user","content":"hello"}}';
    const first = parseTranscriptLine(line);
    const second = parseTranscriptLine(line);
    expect(first?.id).toBe(second?.id);
    expect(first?.id).toMatch(/^line-/);
  });
});

describe('assistant metadata', () => {
  it('sums both cache tiers into the context size', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-opus-4-8',
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 2000,
          cache_read_input_tokens: 30_000,
        },
      },
    });
    expect(assistantMeta(line)).toEqual({ model: 'claude-opus-4-8', contextTokens: 32_100 });
  });

  it('ignores non-assistant lines', () => {
    expect(assistantMeta('{"type":"user","message":{"content":"hi"}}')).toBeNull();
  });
});

describe('model naming', () => {
  it('turns a model id into something a person would say', () => {
    expect(modelDisplayName('claude-opus-4-8')).toBe('Opus 4.8');
    expect(modelDisplayName('claude-fable-5')).toBe('Fable 5');
    expect(modelDisplayName('claude-opus-5[1m]')).toBe('Opus 5');
  });

  // Date suffixes are part of the id, not the name.
  it('drops long date suffixes', () => {
    expect(modelDisplayName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
  });

  it('falls back to the raw id rather than inventing one', () => {
    expect(modelDisplayName('some-internal-build')).toBe('Some');
    expect(modelDisplayName(null)).toBeNull();
  });
});

describe('context label', () => {
  // A count, never a percentage: the window size isn't in the transcript, so a
  // percentage would be a confident-looking guess.
  it('reports thousands once past 1k', () => {
    expect(contextLabel(33_400)).toBe('ctx 33k');
    expect(contextLabel(999)).toBe('ctx 999');
    expect(contextLabel(null)).toBeNull();
  });
});

describe('project directory escaping', () => {
  // Verified empirically against ~/.claude/projects — every non-alphanumeric
  // becomes a hyphen, which is also what keeps the name shell-safe.
  it('matches how Claude escapes a cwd', () => {
    expect(projectDirName('/Users/x/Documents/obsidian/07_homelab')).toBe(
      '-Users-x-Documents-obsidian-07-homelab'
    );
    expect(projectDirName('/tmp/a.b c')).toBe('-tmp-a-b-c');
  });

  it('never emits a character that could escape a shell word', () => {
    expect(projectDirName("/tmp/'; rm -rf /")).toMatch(/^[A-Za-z0-9-]+$/);
  });
});

describe('one-pass entry parsing', () => {
  // The live tail runs this on every appended line, and it is now the only
  // source of the chat header's model and context size. Both halves have to come
  // out of the same parse — the alternative was a second read of the file.
  it('returns the bubble and the metadata together', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      message: {
        model: 'claude-opus-4-8',
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 10, cache_read_input_tokens: 90 },
      },
    });

    const entry = parseTranscriptEntry(line);
    expect(entry.message?.id).toBe('a1');
    expect(entry.message?.role).toBe('assistant');
    expect(entry.meta).toEqual({ model: 'claude-opus-4-8', contextTokens: 100 });
  });

  it('still reports metadata for a turn that draws no bubble', () => {
    // An assistant line with nothing renderable is not a bubble, but it is
    // still evidence of which model is running and how full the context is.
    // Dropping it would leave the header stale through a run of such turns.
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'a2',
      message: { model: 'claude-opus-4-8', content: [], usage: { input_tokens: 5 } },
    });

    const entry = parseTranscriptEntry(line);
    expect(entry.message).toBeNull();
    expect(entry.meta).toEqual({ model: 'claude-opus-4-8', contextTokens: 5 });
  });

  it('has no metadata to report for a user turn', () => {
    const entry = parseTranscriptEntry('{"type":"user","uuid":"u1","message":{"content":"hi"}}');
    expect(entry.message?.role).toBe('user');
    expect(entry.meta).toBeNull();
  });

  it('survives the truncated line a live tail can hand it mid-append', () => {
    expect(parseTranscriptEntry('{"type":"assist')).toEqual({ message: null, meta: null });
  });

  it('agrees with the single-purpose parsers it replaces', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'a3',
      message: {
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 7 },
      },
    });

    const entry = parseTranscriptEntry(line, 'worker');
    expect(entry.message).toEqual(parseTranscriptLine(line, 'worker'));
    expect(entry.meta).toEqual(assistantMeta(line));
  });
});
