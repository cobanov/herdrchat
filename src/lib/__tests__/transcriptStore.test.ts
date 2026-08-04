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
      let slice = bytes.subarray(Math.max(0, oneBased - 1));
      // `older()` bounds its range with `| head -c N`. Honouring it here is what
      // makes the byte assertions mean anything — without it the fake serves the
      // rest of the file and a paging bug would still look correct.
      const bound = /head -c (\d+)/.exec(command);
      if (bound !== null) slice = slice.subarray(0, Number(bound[1]));
      return ok(slice.toString('utf8'));
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

/** "turn 42" -> 42, so paging can be asserted as a contiguous run. */
function turnNumber(text: string): number {
  return Number(text.replace('turn ', ''));
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

describe('older history', () => {
  it('returns the page immediately before the anchor', async () => {
    const file = transcript(200);
    const { store: subject } = store(file);

    const first = await subject.recent('/t.jsonl', null, 2_000);
    const page = await subject.older('/t.jsonl', null, first.startByte, 2_000);

    // The oldest thing on screen and the newest thing in the older page are
    // adjacent turns — no gap between the two windows.
    const lastOlder = displayText(page.messages[page.messages.length - 1]!);
    const firstShown = displayText(first.messages[0]!);
    expect(turnNumber(firstShown)).toBe(turnNumber(lastOlder) + 1);
  });

  // The invariant that matters: paging to the top must show every turn exactly
  // once. An anchor off by one line either repeats a message or loses one, and
  // both look like a rendering glitch rather than a byte-accounting bug.
  it('pages to the start of the file with no gaps and no repeats', async () => {
    const file = transcript(200);
    const { store: subject } = store(file);

    const first = await subject.recent('/t.jsonl', null, 2_000);
    const seen = first.messages.map((message) => turnNumber(displayText(message)));

    let anchor = first.startByte;
    let guard = 0;
    for (;;) {
      const page = await subject.older('/t.jsonl', null, anchor, 700);
      seen.unshift(...page.messages.map((message) => turnNumber(displayText(message))));
      if (page.reachedStart) break;
      expect(page.startByte).toBeLessThan(anchor); // must always make progress
      anchor = page.startByte;
      if ((guard += 1) > 100) throw new Error('older() never reached the start');
    }

    expect(seen).toEqual(Array.from({ length: 200 }, (_, index) => index));
  });

  it('reports reaching the start rather than paging forever', async () => {
    const { store: subject } = store(transcript(5));
    const page = await subject.older('/t.jsonl', null, 40, 10_000);

    expect(page.reachedStart).toBe(true);
    expect(page.startByte).toBe(0);
  });

  it('does nothing at the start of the file', async () => {
    const { store: subject, transport } = store(transcript(5));
    const page = await subject.older('/t.jsonl', null, 0, 10_000);

    expect(page.messages).toEqual([]);
    expect(page.reachedStart).toBe(true);
    // Not even a round-trip: there is nothing before byte zero to ask for.
    expect(transport.commands).toHaveLength(0);
  });

  it('counts the dropped partial line in UTF-8 bytes, not UTF-16 units', async () => {
    // The host counts bytes. An emoji in the discarded fragment is 4 bytes but
    // 2 String units, so a String.length anchor would drift and skip a message.
    const file = `{"type":"user","uuid":"u0","message":{"role":"user","content":"🙂🙂🙂"}}\n${transcript(3)}`;
    const { store: subject } = store(file);

    const anchor = Buffer.from(file, 'utf8').length;
    const page = await subject.older('/t.jsonl', null, anchor, anchor - 5);

    const firstLineBytes = Buffer.from(file.slice(0, file.indexOf('\n') + 1), 'utf8').length;
    expect(page.startByte).toBe(firstLineBytes);
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

  it('drops a workspace whose session is not known yet', async () => {
    // The dangerous case is two chats on ONE folder: they share a project dir,
    // so the newest .jsonl belongs to whichever was touched last. Dropping the
    // request leaves the row on its live status line; guessing would show the
    // other conversation's last message under this one's name.
    const { store: subject, transport } = store('');
    const result = await subject.latestMessages([
      { workspaceId: 'w7', cwd: '/srv/app', sessionId: null },
    ]);

    expect(result.size).toBe(0);
    expect(transport.commands).toHaveLength(0);
  });

  it('queries only the sessions it knows when a batch is mixed', async () => {
    const { store: subject, transport } = store('');
    await subject.latestMessages([
      { workspaceId: 'w7', cwd: '/srv/app', sessionId: null },
      { workspaceId: 'w8', cwd: '/srv/app', sessionId: 'sess-b' },
    ]);

    const script = transport.commands.join('\n');
    expect(script).toContain('sess-b.jsonl');
    expect(script).not.toContain('ls -t');
    // No marker for the unknown workspace, so nothing can be attributed to it.
    expect(script).not.toContain('w7');
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

/**
 * Serves a fixed set of lines to `streamLines`, the way a live `tail -f` would.
 * `exec` is unused here — `tail()` never issues one.
 */
class StreamingTransport implements HerdrTransport {
  readonly commands: string[] = [];

  constructor(private readonly lines: readonly string[]) {}

  async exec(command: string): Promise<ExecResult> {
    this.commands.push(command);
    return ok('');
  }

  async *streamLines(command: string): AsyncIterable<string> {
    this.commands.push(command);
    for (const line of this.lines) yield line;
  }
}

describe('TranscriptStore.tail', () => {
  it('carries header metadata alongside the bubbles', async () => {
    // The model and context size used to come from a separate `tail -c 262144`
    // every ten seconds, re-reading lines that had already streamed through
    // here. If the tail stops reporting `meta` there is no poll to fall back on
    // — the header just freezes at whatever it was seeded with.
    const subject = new TranscriptStore(
      new StreamingTransport([
        '{"type":"user","uuid":"u1","message":{"content":"hi"}}',
        JSON.stringify({
          type: 'assistant',
          uuid: 'a1',
          message: {
            model: 'claude-opus-4-8',
            content: [{ type: 'text', text: 'hello' }],
            usage: { input_tokens: 1000, cache_read_input_tokens: 24_000 },
          },
        }),
      ])
    );

    const chunks = [];
    for await (const chunk of subject.tail('/t.jsonl', null, 0)) chunks.push(chunk);

    expect(chunks[0]?.message?.role).toBe('user');
    expect(chunks[0]?.meta).toBeNull();
    expect(chunks[1]?.message?.role).toBe('assistant');
    expect(chunks[1]?.meta).toEqual({ model: 'claude-opus-4-8', contextTokens: 25_000 });
  });

  it('advances the cursor by UTF-8 bytes, not UTF-16 units', async () => {
    // The host counts bytes. An emoji is one UTF-16 surrogate pair (length 2)
    // and four bytes, so a cursor built from `String.length` drifts short and
    // the next resume re-reads — or, once the drift compounds, skips.
    const line = '{"type":"user","uuid":"u1","message":{"content":"🎉 done"}}';
    const subject = new TranscriptStore(new StreamingTransport([line]));

    const chunks = [];
    for await (const chunk of subject.tail('/t.jsonl', null, 0)) chunks.push(chunk);

    expect(chunks[0]?.consumedBytes).toBe(Buffer.byteLength(line, 'utf8') + 1);
    expect(chunks[0]?.consumedBytes).not.toBe(line.length + 1);
  });

  it('resumes from the byte offset it is given', async () => {
    const subject = new StreamingTransport(['{"type":"user","uuid":"u1","message":{"content":"x"}}']);
    const store = new TranscriptStore(subject);

    for await (const chunk of store.tail('/t.jsonl', null, 4096)) {
      // The first chunk's offset must continue from the resume point, not restart.
      expect(chunk.consumedBytes).toBeGreaterThan(4096);
    }
    expect(subject.commands.join('\n')).toContain('tail -c +4097');
  });
});
