import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { HerdrTransport } from '../herdr/transport';
import { TranscriptStore } from '../transcript/store';

const entry = (type: string, payload: unknown) => JSON.stringify({ type, payload }) + '\n';
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'herdrchat-meta-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

it.each([false, true])('reads the latest exact Codex turn, including beyond the bounded tail (%s)', async long => {
  // Run the actual POSIX command, including quoting, rather than teaching a
  // fake host the answer. No credentials or real conversations are used.
  const path = join(directory, "session's $(not-a-command).jsonl");
  writeFileSync(path,
    entry('turn_context', { model: 'gpt-old', effort: 'low' }) +
    entry('turn_context', { model: 'gpt-current', effort: 'high' }) +
    entry('response_item', { type: 'function_call_output', output: 'x'.repeat(long ? 300_000 : 10) }) +
    entry('event_msg', { type: 'token_count', info: { last_token_usage: { input_tokens: 1234 } } }));
  const commands: string[] = [];
  const transport: HerdrTransport = {
    async exec(command) {
      commands.push(command);
      return { ok: true, exitCode: 0, stderr: '', stdout: execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' }) };
    },
    async *streamLines() {},
  };
  expect(await new TranscriptStore(transport).sessionMeta(path, 'codex')).toEqual({
    model: 'gpt-current', effort: 'high', contextTokens: 1234,
  });
  expect(commands).toHaveLength(long ? 2 : 1);
  expect(commands.some(command => command.includes('awk '))).toBe(long);
});

it('does not borrow effort from an earlier turn when the latest turn omits it', async () => {
  const transport: HerdrTransport = {
    async exec() {
      return { ok: true, exitCode: 0, stderr: '', stdout:
        entry('turn_context', { model: 'gpt-old', effort: 'high' }) +
        entry('turn_context', { model: 'gpt-new' }) };
    },
    async *streamLines() {},
  };
  expect(await new TranscriptStore(transport).sessionMeta('/exact.jsonl', 'codex')).toEqual({
    model: 'gpt-new', effort: null, contextTokens: null,
  });
});
