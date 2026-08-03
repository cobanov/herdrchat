import type { ExecResult } from '../../../modules/herdr-ssh/src';
import type { HerdrTransport } from '../herdr/transport';
import { displayText } from '../transcript/message';
import { TranscriptStore, previewText } from '../transcript/store';

/**
 * Covers `TranscriptStore.recent` — the bounded history window a chat thread
 * opens with. Its invariants are easy to break and expensive to notice: get the
 * byte accounting wrong and the live tail either re-reads history or skips
 * messages outright.
 */

/** Serves a canned transcript, answering the size probe and the window read. */
class FakeTransport implements HerdrTransport {
  readonly commands: string[] = [];

  constructor(private readonly file: string) {}

  async exec(command: string): Promise<ExecResult> {
    this.commands.push(command);
    const bytes = Buffer.from(this.file, 'utf8');

    if (command.includes('wc -c')) return ok(`${bytes.length}\n`);

    const window = /tail -c \+(\d+)/.exec(command);
    if (window !== null) {
      const oneBased = Number(window[1]);
      return ok(bytes.subarray(Math.max(0, oneBased - 1)).toString('utf8'));
    }

    const tail = /tail -c (\d+)/.exec(command);
    if (tail !== null) {
      return ok(bytes.subarray(Math.max(0, bytes.length - Number(tail[1]))).toString('utf8'));
    }

    return ok('');
  }

  async *streamLines(): AsyncIterable<string> {
    // no live tail in these tests
  }
}

function ok(stdout: string): ExecResult {
  return { ok: true, stdout, stderr: '', exitCode: 0 };
}

/** One user turn per line, so bubble count is predictable. */
function transcript(turns: number): string {
  const lines = Array.from(
    { length: turns },
    (_, index) =>
      `{"type":"user","uuid":"u${index}","message":{"role":"user","content":"turn ${index}"}}`
  );
  return `${lines.join('\n')}\n`;
}

function store(file: string): { store: TranscriptStore; transport: FakeTransport } {
  const transport = new FakeTransport(file);
  return { store: new TranscriptStore(transport), transport };
}

describe('recent window', () => {
  // The whole point of the window: a dense transcript must not hand the chat
  // surface thousands of bubbles to lay out.
  it('keeps only the newest turns under the message cap', async () => {
    const file = transcript(500);
    const result = await store(file).store.recent('/t.jsonl', null, 10_000_000, 20);

    expect(result.messages).toHaveLength(20);
    // Newest kept, oldest dropped — a chat opens on recency.
    expect(displayText(result.messages[result.messages.length - 1]!)).toBe('turn 499');
    expect(displayText(result.messages[0]!)).toBe('turn 480');
  });

  // Trimming is a display concern and must NOT move the tail cursor: the tail
  // has to resume at the real end of file, or every trimmed message would be
  // re-read and re-appended as if it were new.
  it('reports the whole window as consumed, not the kept slice', async () => {
    const file = transcript(500);
    const result = await store(file).store.recent('/t.jsonl', null, 10_000_000, 5);

    expect(result.messages).toHaveLength(5);
    expect(result.consumedBytes).toBe(Buffer.byteLength(file, 'utf8'));
  });

  // A byte window that starts mid-file lands mid-line. That fragment must be
  // dropped rather than parsed into a half-formed bubble.
  it('drops a partial first line', async () => {
    const file = transcript(40);
    const maxBytes = Buffer.byteLength(file, 'utf8') - 30;
    const result = await store(file).store.recent('/t.jsonl', null, maxBytes);

    expect(result.messages.length).toBeGreaterThan(0);
    for (const message of result.messages) {
      expect(displayText(message)).toMatch(/^turn /);
    }
    expect(result.consumedBytes).toBe(Buffer.byteLength(file, 'utf8'));
  });

  // The common case for a young session: nothing to trim, nothing to drop.
  it('reads a short transcript whole', async () => {
    const file = transcript(6);
    const result = await store(file).store.recent('/t.jsonl', null, 10_000_000, 150);

    expect(result.messages).toHaveLength(6);
    expect(displayText(result.messages[0]!)).toBe('turn 0');
    expect(result.consumedBytes).toBe(Buffer.byteLength(file, 'utf8'));
  });

  // Offsets are BYTE offsets on the host. Counting UTF-16 units would drift the
  // tail cursor on any transcript containing an emoji or a non-Latin script,
  // and the drift silently skips messages.
  it('accounts in bytes, not characters', async () => {
    const file = `{"type":"user","uuid":"u0","message":{"role":"user","content":"herşey 🎉 tamam"}}\n`;
    const result = await store(file).store.recent('/t.jsonl', null, 10_000_000);

    expect(result.consumedBytes).toBe(Buffer.byteLength(file, 'utf8'));
    expect(result.consumedBytes).toBeGreaterThan(file.length);
  });
});

describe('session transcript path', () => {
  const { store: subject } = store('');

  it('targets the exact session file', () => {
    expect(subject.sessionTranscriptPath('/home/me', '/srv/app', 'abc-123')).toBe(
      '/home/me/.claude/projects/-srv-app/abc-123.jsonl'
    );
  });

  // A session id is interpolated into a shell command, so anything that isn't
  // obviously inert must be refused rather than quoted and hoped for.
  it('refuses a session id that could escape the path', () => {
    expect(subject.sessionTranscriptPath('/home/me', '/srv', '../../etc/passwd')).toBeNull();
    expect(subject.sessionTranscriptPath('/home/me', '/srv', "a'; rm -rf /")).toBeNull();
    expect(subject.sessionTranscriptPath('/home/me', '/srv', '')).toBeNull();
  });
});

describe('list previews', () => {
  it('collapses a turn into one plain line', () => {
    const message = {
      id: 'm1',
      role: 'assistant' as const,
      segments: [{ kind: 'text' as const, text: '## Done\n\nAll **three** tests `pass`.' }],
      timestamp: null,
      agentLabel: null,
      isSidechain: false,
    };
    expect(previewText(message)).toBe('Done All three tests pass.');
  });

  it('is null for a turn with nothing to show', () => {
    expect(
      previewText({
        id: 'm2',
        role: 'assistant',
        segments: [{ kind: 'toolUse', name: 'Bash', input: 'ls' }],
        timestamp: null,
        agentLabel: null,
        isSidechain: false,
      })
    ).toBeNull();
  });
});

describe('batched last-message lookup', () => {
  // A workspace whose session isn't known yet must NOT fall back to the newest
  // .jsonl in the project dir: that previews a previous chat's last message
  // under a reused workspace, which is a reported bug, not a theory.
  it('never guesses a transcript when a session id is known', async () => {
    const { store: subject, transport } = store('');
    await subject.latestMessages([{ workspaceId: 'w7', cwd: '/srv/app', sessionId: 'sess-a' }]);

    const script = transport.commands.join('\n');
    expect(script).toContain('sess-a.jsonl');
    expect(script).not.toContain('ls -t');
  });

  it('refuses a workspace id that could escape the script', async () => {
    const { store: subject, transport } = store('');
    const result = await subject.latestMessages([
      { workspaceId: "w7'; rm -rf /", cwd: '/srv/app', sessionId: null },
    ]);

    expect(result.size).toBe(0);
    expect(transport.commands).toHaveLength(0);
  });
});
