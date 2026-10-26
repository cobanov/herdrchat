import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExecResult } from '../../../modules/herdr-ssh/src';
import type { HerdrTransport } from '../herdr/transport';
import { displayText } from '../transcript/message';
import { projectDirName } from '../transcript/parser';
import { TranscriptStore } from '../transcript/store';

/**
 * The chat list's preview and the header's model, read by the real scripts
 * under `sh` from a real file: a transcript that ends on a screenshot. Read
 * as a plain `tail -c`, the window held one picture line and nothing to show.
 */
const home = mkdtempSync(join(tmpdir(), 'strip-'));
const cwd = '/Users/me/work';
const id = '11111111-2222-4333-8444-555555555555';
const lines = [
  { type: 'user', uuid: 'u1', timestamp: '2026-10-16T00:00:00Z', message: { role: 'user', content: 'check the screenshot' } },
  { type: 'assistant', uuid: 'a1', timestamp: '2026-10-16T00:00:01Z',
    message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'All done.' }],
      usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  { type: 'user', uuid: 'u2', timestamp: '2026-10-16T00:00:02Z', message: { role: 'user', content: [{
    type: 'tool_result', tool_use_id: 't1',
    content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(300_000) } }],
  }] } },
];
const folder = join(home, '.claude', 'projects', projectDirName(cwd));
mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, `${id}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n') + '\n');

const stdouts: string[] = [];
const shell: HerdrTransport = {
  exec: async (command): Promise<ExecResult> => {
    const run = spawnSync('sh', ['-c', command], {
      env: { NODE_ENV: 'test', PATH: '/usr/bin:/bin', HOME: home }, maxBuffer: 16 * 1024 * 1024,
    });
    stdouts.push(run.stdout.toString());
    return { ok: true, exitCode: run.status ?? 1, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
  },
  streamLines: async function* () { yield* []; },
};

it('previews the last reply of a chat that ends on a screenshot, and sends no picture', async () => {
  const previews = await new TranscriptStore(shell).latestMessages([{ workspaceId: 'w1', cwd, sessionId: id, agent: 'claude' }]);
  expect(displayText(previews.get('w1')!)).toBe('All done.');
  expect(stdouts.at(-1)!.length).toBeLessThan(48_000 + 200);
  expect(stdouts.at(-1)).not.toContain('AAAAAAAA');
});

it("reads the header's model past a screenshot", async () => {
  const meta = await new TranscriptStore(shell).sessionMeta(join(folder, `${id}.jsonl`), 'claude', 1_000);
  expect(meta?.model).toBe('claude-opus-5');
});
