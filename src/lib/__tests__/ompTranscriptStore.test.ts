import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { HerdrTransport } from '../herdr/transport';
import { displayText } from '../transcript/message';
import { TranscriptStore } from '../transcript/store';

let home: string;
let store: TranscriptStore;
let calls: number;
const id = 'abc-123';
const header = JSON.stringify({ type: 'session', version: 3, id, cwd: '/work' });
const reply = JSON.stringify({ type: 'message', id: 'reply', parentId: null,
  timestamp: '2026-09-28T10:00:00Z', message: { role: 'assistant', model: 'gpt-5',
    content: [{ type: 'text', text: 'Hello 👋' }], usage: { input: 10, cacheRead: 20, cacheWrite: 5 } } });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'herdrchat-omp-'));
  calls = 0;
  const transport: HerdrTransport = {
    async exec(command) {
      calls += 1;
      const result = spawnSync('sh', ['-c', command], { encoding: 'utf8', env: {
        ...process.env, HOME: home, PI_CODING_AGENT_DIR: '', PI_CONFIG_DIR: '', XDG_DATA_HOME: '',
      } });
      if (result.error) throw result.error;
      return { ok: true, exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    },
    async *streamLines() { yield* []; },
  };
  store = new TranscriptStore(transport);
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

function session(path: string, body = `${header}\n${reply}\n`): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  return path;
}

it('opens the reported custom path, including shell punctuation, instead of a newer sibling', async () => {
  const path = session(join(home, "custom dir's", '$(not-a-command).jsonl'));
  session(join(home, '.omp/agent/sessions/work', 'newer_other-id.jsonl'));
  expect(await store.ompTranscriptPath(path, 'path')).toBe(path);
  await store.verifyOmpTranscript(path, null);
  const recent = await store.recent(path, null, 100_000);
  expect(recent.messages.map(displayText)).toEqual(['Hello 👋']);
  expect(recent.consumedBytes).toBe(Buffer.byteLength(`${header}\n${reply}\n`));
  const preview = await store.latestMessages([
    { workspaceId: 'w1', cwd: '/work', agent: 'omp', sessionKind: 'path', sessionId: path },
  ]);
  expect(displayText(preview.get('w1')!)).toBe('Hello 👋');
});

it('waits for a reported file that has not materialized rather than opening a sibling', async () => {
  session(join(home, '.omp/agent/sessions/work', 'other_other-id.jsonl'));
  const path = join(home, 'not-yet.jsonl');
  expect(await store.ompTranscriptPath(path, 'path')).toBe(path);
  expect(await store.fileProbe(path)).toEqual({ kind: 'absent' });
  expect(await store.ompTranscriptPath(id, 'id')).toBeNull();
});

it('resolves id-only reports exactly and rejects duplicate ids and mismatched headers', async () => {
  const path = session(join(home, '.omp/agent/sessions/work', `timestamp_${id}.jsonl`));
  expect(await store.ompTranscriptPath(id, 'id')).toBe(path);
  await expect(store.verifyOmpTranscript(path, 'another-id')).rejects.toMatchObject({ code: 'omp_session_mismatch' });
  session(join(home, '.omp/profiles/work/agent/sessions/work', `timestamp_${id}.jsonl`));
  store.forgetOmpTranscript(id);
  await expect(store.ompTranscriptPath(id, 'id')).rejects.toMatchObject({ code: 'omp_session_ambiguous' });
});

it.each(['../secret.jsonl', '/tmp/../secret.jsonl', '/../secret.jsonl', '/tmp//../secret.jsonl',
  '/tmp/chat.jsonl\n/etc/passwd', '/tmp/chat\0.jsonl', ''])('rejects unsafe path %p', async value => {
  expect(await store.ompTranscriptPath(value, 'path')).toBeNull();
});

it('does not preview a foreign format, while keeping readable sibling previews', async () => {
  const foreign = session(join(home, 'foreign.jsonl'), `${JSON.stringify({ type: 'session_meta', payload: { id } })}\n${reply}\n`);
  const valid = session(join(home, 'valid.jsonl'));
  await expect(store.verifyOmpTranscript(foreign, null)).rejects.toMatchObject({ code: 'omp_session_mismatch' });
  const previews = await store.latestMessages([
    { workspaceId: 'w1', cwd: '/work', agent: 'omp', sessionKind: 'path', sessionId: foreign },
    { workspaceId: 'w2', cwd: '/work', agent: 'omp', sessionKind: 'path', sessionId: valid },
  ]);
  expect(previews.has('w1')).toBe(false);
  expect(displayText(previews.get('w2')!)).toBe('Hello 👋');
});

it('seeds thinking settings older than the bounded tail independently of the assistant model', async () => {
  const effort = JSON.stringify({ type: 'thinking_level_change', thinkingLevel: 'high' });
  const path = session(join(home, 'meta.jsonl'), `${header}\n${effort}\n${reply}\n`);
  expect(await store.sessionMeta(path, 'omp', Buffer.byteLength(reply) + 1)).toEqual({
    model: 'gpt-5', effort: 'high', contextTokens: 35,
  });
});

it('accepts current title-prefixed journals without confusing the title with session identity', async () => {
  const slot = JSON.stringify({ type: 'title', v: 1, title: 'A title', updatedAt: '2026-09-28T10:00:00Z', pad: '' });
  const path = session(join(home, 'titled.jsonl'), `${slot}\n${header}\n${reply}\n`);
  await store.verifyOmpTranscript(path, id);
  await expect(store.verifyOmpTranscript(path, 'wrong-id')).rejects.toMatchObject({ code: 'omp_session_mismatch' });
  const recent = await store.recent(path, null, 100_000);
  expect(recent.messages.map(displayText)).toEqual(['Hello 👋']);
  const previews = await store.latestMessages([
    { workspaceId: 'w1', cwd: '/work', agent: 'omp', sessionKind: 'path', sessionId: path },
  ]);
  expect(displayText(previews.get('w1')!)).toBe('Hello 👋');
});

it.each(['absent', 'mismatched'])('recovers automatically when a cached id file becomes %s', async state => {
  const old = session(join(home, '.omp/agent/sessions/old', `timestamp_${id}.jsonl`));
  const requests = [{ workspaceId: 'w1', cwd: '/work', agent: 'omp', sessionKind: 'id', sessionId: id }];
  expect(displayText((await store.latestMessages(requests)).get('w1')!)).toBe('Hello 👋');
  if (state === 'absent') rmSync(old);
  else writeFileSync(old, `${JSON.stringify({ type: 'session', id: 'foreign' })}\n${reply}\n`);
  expect((await store.latestMessages(requests)).has('w1')).toBe(false);
  rmSync(old, { force: true });
  session(join(home, '.omp/agent/sessions/moved', `timestamp_${id}.jsonl`),
    `${header}\n${reply.replace('Hello 👋', 'Recovered')}\n`);
  expect(displayText((await store.latestMessages(requests)).get('w1')!)).toBe('Recovered');
});

it('batches path-based previews and header validation even with an unreadable sibling', async () => {
  const first = session(join(home, 'first.jsonl'));
  const second = session(join(home, 'second.jsonl'), `${header}\n${reply.replace('Hello 👋', 'Second reply')}\n`);
  const previews = await store.latestMessages([
    { workspaceId: 'w1', cwd: '/work', agent: 'omp', sessionKind: 'path', sessionId: first },
    { workspaceId: 'w2', cwd: '/work', agent: 'omp', sessionKind: 'path', sessionId: join(home, 'missing.jsonl') },
    { workspaceId: 'w3', cwd: '/work', agent: 'omp', sessionKind: 'path', sessionId: second },
  ]);
  expect([...previews].map(([id, message]) => [id, displayText(message)])).toEqual([
    ['w1', 'Hello 👋'], ['w3', 'Second reply'],
  ]);
  expect(calls).toBe(1);
});

// Pi writes the journal OMP forked: no title slot, `provider` + `modelId` on
// model changes, usage on the reply. Recorded shapes, made-up content.
it('previews and seeds a Pi journal through the same reader', async () => {
  const piHeader = JSON.stringify({ type: 'session', version: 3, id, timestamp: '2026-09-28T10:00:00Z', cwd: '/work' });
  const model = JSON.stringify({ type: 'model_change', id: 'm1', parentId: null,
    timestamp: '2026-09-28T10:00:00Z', provider: 'anthropic', modelId: 'claude-opus-4-5' });
  const effort = JSON.stringify({ type: 'thinking_level_change', id: 't1', parentId: 'm1',
    timestamp: '2026-09-28T10:00:00Z', thinkingLevel: 'high' });
  const piReply = JSON.stringify({ type: 'message', id: 'r1', parentId: 't1', timestamp: '2026-09-28T10:00:01Z',
    message: { role: 'assistant', api: 'anthropic-messages', provider: 'anthropic', model: 'claude-opus-4-5',
      content: [{ type: 'thinking', thinking: 'Plan.' }, { type: 'text', text: 'Hej fra Pi' }],
      usage: { input: 4, output: 9, cacheRead: 100, cacheWrite: 20, totalTokens: 133 }, stopReason: 'stop' } });
  const path = session(join(home, '.pi/agent/sessions/--work--', `2026-09-28T10-00-00-000Z_${id}.jsonl`),
    `${piHeader}\n${model}\n${effort}\n${piReply}\n`);

  await expect(store.verifyOmpTranscript(path, null)).resolves.toBeUndefined();
  const previews = await store.latestMessages([
    { workspaceId: 'w1', cwd: '/work', agent: 'pi', sessionKind: 'path', sessionId: path },
  ]);
  expect(displayText(previews.get('w1')!)).toBe('Hej fra Pi');
  // Settings older than the tail still reach the header.
  expect(await store.sessionMeta(path, 'pi', Buffer.byteLength(piReply) + 1)).toEqual({
    model: 'claude-opus-4-5', effort: 'high', contextTokens: 124,
  });

  // An aborted turn reports zero usage; the context is the last real reply's.
  const aborted = JSON.stringify({ type: 'message', id: 'r2', parentId: 'r1', timestamp: '2026-09-28T10:00:02Z',
    message: { role: 'assistant', model: 'claude-opus-4-5', content: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }, stopReason: 'aborted' } });
  const abortedPath = session(join(home, '.pi/agent/sessions/--work--', `2026-09-28T10-00-02-000Z_${id}.jsonl`),
    `${piHeader}\n${model}\n${effort}\n${piReply}\n${aborted}\n`);
  expect((await store.sessionMeta(abortedPath, 'pi'))?.contextTokens).toBe(124);
});
