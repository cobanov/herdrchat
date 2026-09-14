import type { ExecResult } from '../../../modules/herdr-ssh/src';
import type { HerdrTransport } from '../herdr/transport';
import { TranscriptStore } from '../transcript/store';
import { displayText } from '../transcript/message';

const id = 'abc-123';
const path = `/host/.codex/sessions/2026/09/14/rollout-2026-09-14T12-00-00-${id}.jsonl`;
const header = JSON.stringify({ type: 'session_meta', payload: { id, cwd: '/same-folder' } });
const reply = JSON.stringify({ type: 'response_item', timestamp: '2026-09-14T12:00:01Z', payload: {
  type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello 👋' }],
} });
const ok = (stdout: string): ExecResult => ({ ok: true, exitCode: 0, stdout, stderr: '' });

class CodexHost implements HerdrTransport {
  commands: string[] = [];
  matches = path + '\n';
  header = header;
  fail = false;
  file = `${header}\n${reply}\n`;
  async exec(command: string): Promise<ExecResult> {
    this.commands.push(command);
    if (this.fail) return { ok: false, code: 'connect_failed', message: 'Offline' };
    if (command.includes('find ')) return ok(this.matches);
    if (command.includes('head -n 1')) return ok(this.header);
    if (command.includes('wc -c')) return ok(String(Buffer.byteLength(this.file)));
    const marker = /\\n(__HERDRCHAT_[A-Za-z0-9_]+__|@@HERDRCHAT[^ ]*) %s/.exec(command)?.[1];
    if (marker !== undefined) return ok(`\n${marker} w1\n${this.file}`);
    return ok(this.file);
  }
  async *streamLines(): AsyncIterable<string> { yield reply; }
}

describe('exact Codex transcript resolution', () => {
  it('searches by the native id and verifies session_meta, never cwd or newest', async () => {
    const host = new CodexHost();
    const store = new TranscriptStore(host);
    expect(await store.codexTranscriptPath(id)).toBe(path);
    const script = host.commands.join('\n');
    expect(script).toContain('rollout-*-abc-123.jsonl');
    expect(script).toContain('${CODEX_HOME:-$HOME/.codex}');
    expect(script).toContain('/archived_sessions');
    expect(script).toContain('head -n 1');
    expect(script).not.toContain('/same-folder');
    expect(script).not.toMatch(/ls -t|sort|newest/);
  });

  it('reuses successful resolution across stores on one connection', async () => {
    const host = new CodexHost();
    const a = new TranscriptStore(host);
    const b = new TranscriptStore(host);
    expect(await Promise.all([a.codexTranscriptPath(id), b.codexTranscriptPath(id)])).toEqual([path, path]);
    expect(host.commands.filter(command => command.includes('find '))).toHaveLength(1);
  });

  it('does not carry paths across connections or guesses across sessions', async () => {
    const first = new CodexHost();
    await new TranscriptStore(first).codexTranscriptPath(id);
    const second = new CodexHost();
    second.matches = '';
    expect(await new TranscriptStore(second).codexTranscriptPath(id)).toBeNull();
    await expect(new TranscriptStore(first).codexTranscriptPath('other-id')).rejects.toMatchObject({ code: 'codex_session_invalid' });
  });

  it('rejects duplicate files and mismatched metadata without reading messages', async () => {
    const host = new CodexHost();
    host.matches += path.replace('/sessions/', '/archived_sessions/') + '\n';
    await expect(new TranscriptStore(host).codexTranscriptPath(id)).rejects.toMatchObject({ code: 'codex_session_ambiguous' });
    host.matches = path + '\n';
    host.header = JSON.stringify({ type: 'session_meta', payload: { id: 'different-session' } });
    await expect(new TranscriptStore(host).codexTranscriptPath(id)).rejects.toMatchObject({ code: 'codex_session_mismatch' });
    expect(host.commands.every(command => !command.includes('tail -c'))).toBe(true);
  });

  it.each(['', '../secret', "x'; touch /tmp/no", 'x\ny'])('refuses unsafe id %p before a host command', async value => {
    const host = new CodexHost();
    expect(await new TranscriptStore(host).codexTranscriptPath(value)).toBeNull();
    expect(host.commands).toEqual([]);
  });

  it('retries missing and failed lookups and re-resolves a moved transcript', async () => {
    const host = new CodexHost();
    const store = new TranscriptStore(host);
    host.matches = '';
    expect(await store.codexTranscriptPath(id)).toBeNull();
    host.fail = true;
    await expect(store.codexTranscriptPath(id)).rejects.toThrow('Offline');
    host.fail = false;
    host.matches = path + '\n';
    expect(await store.codexTranscriptPath(id)).toBe(path);
    store.forgetCodexTranscript(id);
    host.matches = path.replace('/sessions/', '/archived_sessions/') + '\n';
    expect(await store.codexTranscriptPath(id)).toContain('/archived_sessions/');
  });

  it('uses the same parser and byte accounting for recent history and live updates', async () => {
    const host = new CodexHost();
    const store = new TranscriptStore(host);
    const recent = await store.recent(path, null, 100_000);
    expect(recent.messages.map(displayText)).toEqual(['Hello 👋']);
    expect(recent.consumedBytes).toBe(Buffer.byteLength(host.file));
    for await (const chunk of store.tail(path, null, 0)) {
      expect(chunk.message?.id).toBe(recent.messages[0]?.id);
      expect(chunk.consumedBytes).toBe(Buffer.byteLength(reply) + 1);
    }
  });

  it('uses the resolved Codex file for a chat-list preview, not a Claude path', async () => {
    const host = new CodexHost();
    const messages = await new TranscriptStore(host).latestMessages([
      { workspaceId: 'w1', cwd: '/same-folder', sessionId: id, agent: 'codex' },
    ]);
    expect(displayText(messages.get('w1')!)).toBe('Hello 👋');
    expect(host.commands.at(-1)).toContain(path);
    expect(host.commands.at(-1)).not.toContain('/.claude/');
  });

  it('keeps a failed Codex lookup from preventing other previews', async () => {
    const host = new CodexHost();
    host.matches += path + '\n';
    await new TranscriptStore(host).latestMessages([
      { workspaceId: 'w2', cwd: '/same-folder', sessionId: id, agent: 'codex' },
      { workspaceId: 'w1', cwd: '/same-folder', sessionId: 'claude-id', agent: 'claude' },
    ]);
    expect(host.commands.at(-1)).toContain('claude-id.jsonl');
    expect(host.commands.at(-1)).not.toContain(path);
  });
});
