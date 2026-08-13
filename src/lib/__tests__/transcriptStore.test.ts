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

/**
 * A canned host whose file can grow and whose live tail serves raw bytes from
 * the requested offset. Slicing the Buffer BEFORE decoding is the point: a
 * window that starts inside a code point decodes lossily into U+FFFD, exactly
 * as the native side does — the plain FakeTransport above does the same, but
 * no test there ever starts mid-code-point, which is why the drift bug was
 * unreproducible in this suite.
 */
class LossyTailTransport implements HerdrTransport {
  private file: Buffer;

  constructor(initial: string) {
    this.file = Buffer.from(initial, 'utf8');
  }

  append(text: string): void {
    this.file = Buffer.concat([this.file, Buffer.from(text, 'utf8')]);
  }

  async exec(command: string): Promise<ExecResult> {
    if (command.includes('wc -c')) return ok(`${this.file.length}\n`);
    const window = /tail -c \+(\d+)/.exec(command);
    if (window !== null) {
      return ok(this.file.subarray(Number(window[1]) - 1).toString('utf8'));
    }
    return ok('');
  }

  async *streamLines(command: string): AsyncIterable<string> {
    const from = /tail -c \+(\d+)/.exec(command);
    const start = from === null ? 0 : Number(from[1]) - 1;
    for (const line of this.file.subarray(start).toString('utf8').split('\n')) {
      if (line.length > 0) yield line;
    }
  }
}

describe('recent window starting mid-code-point', () => {
  /** Emoji on both sides of every turn, so any byte window lands near one. */
  function emojiTranscript(turns: number): string {
    const lines = Array.from(
      { length: turns },
      (_, index) =>
        `{"type":"user","uuid":"e${index}","message":{"role":"user","content":"🎉🚀 turn ${index} 🐢"}}`
    );
    return `${lines.join('\n')}\n`;
  }

  /** A window start two bytes inside line 3's leading 🎉 — mid-code-point. */
  function midEmojiStart(base: string): number {
    const emojiChar = base.indexOf('🎉', base.indexOf('"uuid":"e3"'));
    return Buffer.byteLength(base.slice(0, emojiChar), 'utf8') + 2;
  }

  // `start = size - maxBytes` is an arbitrary byte, not a boundary. Landing
  // inside a 4-byte 🎉 strands its last two bytes at the head of the window;
  // the lossy decode turns them into TWO U+FFFD. Each U+FFFD counts 3 bytes
  // but replaced only 1, so the old arithmetic — consumed = start +
  // byteLength(decoded window) — came out 4 bytes PAST the real end of file.
  it('never reports a cursor past the end of file', async () => {
    const base = emojiTranscript(6);
    const size = Buffer.byteLength(base, 'utf8');
    const start = midEmojiStart(base);
    const subject = new TranscriptStore(new LossyTailTransport(base));

    const result = await subject.recent('/t.jsonl', null, size - start);

    expect(result.consumedBytes).toBe(size);
    // The damaged fragment was dropped with the usual partial first line; the
    // full lines after it still parse with their emoji intact.
    expect(result.messages.map((message) => displayText(message))).toEqual([
      '🎉🚀 turn 4 🐢',
      '🎉🚀 turn 5 🐢',
    ]);
  });

  // The invariant behind the clamp: a tail started at consumedBytes must see
  // every later message. Under the old arithmetic the cursor sat 4 bytes past
  // EOF, the tail began 4 bytes INSIDE the next appended line, that line's
  // JSON never parsed, and 'turn 6' was silently lost.
  it('tailing from consumedBytes yields every subsequent message intact', async () => {
    const base = emojiTranscript(6);
    const size = Buffer.byteLength(base, 'utf8');
    const transport = new LossyTailTransport(base);
    const subject = new TranscriptStore(transport);

    const result = await subject.recent('/t.jsonl', null, size - midEmojiStart(base));
    transport.append(
      `{"type":"user","uuid":"e6","message":{"role":"user","content":"🎁 turn 6"}}\n` +
        `{"type":"user","uuid":"e7","message":{"role":"user","content":"turn 7 🏁"}}\n`
    );

    const streamed: string[] = [];
    for await (const chunk of subject.tail('/t.jsonl', null, result.consumedBytes)) {
      if (chunk.message !== null) streamed.push(displayText(chunk.message));
    }
    expect(streamed).toEqual(['🎁 turn 6', 'turn 7 🏁']);
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

/**
 * `fileProbe` has to answer three questions, not two.
 *
 * It used to return `-1` for both "no such file" and "the read failed", with
 * `2>/dev/null` discarding the only evidence that separated them — so a
 * permission or transport problem was indistinguishable from a session whose
 * transcript hadn't been written yet, and the thread waited silently for a file
 * that was already there.
 */
describe('TranscriptStore.fileProbe', () => {
  class ProbeTransport implements HerdrTransport {
    constructor(private readonly result: ExecResult) {}
    async exec(): Promise<ExecResult> {
      return this.result;
    }
    async *streamLines(): AsyncIterable<string> {}
  }

  const probe = (result: ExecResult) =>
    new TranscriptStore(new ProbeTransport(result)).fileProbe('/t.jsonl');

  it('reports a size when the host answers with one', async () => {
    await expect(probe({ ok: true, stdout: '  4096\n', stderr: '', exitCode: 0 })).resolves.toEqual({
      kind: 'size',
      bytes: 4096,
    });
  });

  it('reports absent on the exit status the probe reserves for it', async () => {
    await expect(
      probe({ ok: true, stdout: '', stderr: '', exitCode: 44 })
    ).resolves.toEqual({ kind: 'absent' });
  });

  // The old probe read the shell's English. A host with a localized libc says
  // the same thing in its own words, and every freshly-created session then
  // read `unknown` — a broken transcript — instead of "wait a beat".
  it('reports absent on a host that does not speak English', async () => {
    await expect(
      probe({
        ok: true,
        stdout: '',
        stderr: 'sh: /t.jsonl: Datei oder Verzeichnis nicht gefunden\n',
        exitCode: 44,
      })
    ).resolves.toEqual({ kind: 'absent' });
  });

  it('asks the shell whether the file exists rather than reading its stderr', async () => {
    const commands: string[] = [];
    class Recording implements HerdrTransport {
      async exec(command: string): Promise<ExecResult> {
        commands.push(command);
        return ok('12\n');
      }
      async *streamLines(): AsyncIterable<string> {}
    }
    await new TranscriptStore(new Recording()).fileProbe('/t.jsonl');
    expect(commands[0]).toContain('[ -f ');
    expect(commands[0]).toContain('exit 44');
  });

  it('reports unknown — not absent — when the read failed for another reason', async () => {
    await expect(
      probe({ ok: true, stdout: '', stderr: 'wc: /t.jsonl: Permission denied\n', exitCode: 1 })
    ).resolves.toEqual({ kind: 'unknown', reason: 'wc: /t.jsonl: Permission denied' });
  });

  it('reports unknown when the transport itself failed', async () => {
    await expect(
      probe({ ok: false, code: 'transport_failed', message: 'connection reset' })
    ).resolves.toEqual({ kind: 'unknown', reason: 'connection reset' });
  });

  it('reports unknown rather than guess when the output is not a number', async () => {
    const result = await probe({ ok: true, stdout: 'wat\n', stderr: '', exitCode: 0 });
    expect(result.kind).toBe('unknown');
  });
});

describe('shell failures inside the store', () => {
  class FailingTransport implements HerdrTransport {
    constructor(private readonly result: ExecResult) {}
    async exec(): Promise<ExecResult> {
      return this.result;
    }
    async *streamLines(): AsyncIterable<string> {}
  }

  // 127 here is `tail`/`wc`/`head` missing from a non-interactive PATH, not
  // herdr. Blaming herdr sends the reader off to install something that is
  // already installed.
  it('names the tools it actually runs on exit 127', async () => {
    const subject = new TranscriptStore(
      new FailingTransport({ ok: true, stdout: '', stderr: 'tail: not found', exitCode: 127 })
    );
    await expect(subject.sessionMeta('/t.jsonl')).rejects.toThrow(/tail, wc and head/);
    await expect(subject.sessionMeta('/t.jsonl')).rejects.not.toThrow(/herdr/);
  });

  it('fails loudly when the host will not say where home is', async () => {
    const subject = new TranscriptStore(
      new FailingTransport({ ok: true, stdout: '\n', stderr: '', exitCode: 0 })
    );
    // '~' was returned here once, and every path built from it was single-quoted
    // downstream, so the host looked for a directory literally named "~".
    await expect(subject.homeDirectory()).rejects.toThrow(/home directory/);
  });
});

describe('home directory caching', () => {
  it('asks the host once per store', async () => {
    const commands: string[] = [];
    class HomeTransport implements HerdrTransport {
      async exec(command: string): Promise<ExecResult> {
        commands.push(command);
        return ok('/home/ege');
      }
      async *streamLines(): AsyncIterable<string> {}
    }
    const subject = new TranscriptStore(new HomeTransport());
    expect(await subject.homeDirectory()).toBe('/home/ege');
    expect(await subject.homeDirectory()).toBe('/home/ege');
    expect(commands).toHaveLength(1);
  });
});

describe('preview marker collision', () => {
  /** Echoes the script's own marker lines, then serves the canned transcript. */
  class MarkerTransport implements HerdrTransport {
    constructor(private readonly body: string) {}

    async exec(command: string): Promise<ExecResult> {
      let out = '';
      for (const match of command.matchAll(/printf '\\n(\S+) %s\\n' '([^']+)'/g)) {
        out += `\n${match[1]} ${match[2]}\n${this.body}`;
      }
      return ok(out);
    }
    async *streamLines(): AsyncIterable<string> {}
  }

  // A chat ABOUT this app writes the separator verbatim. With a static marker
  // the split filed the rest of that transcript under a workspace id read out
  // of the transcript's own text.
  it('is immune to a transcript that contains the separator', async () => {
    const poison = JSON.stringify({
      type: 'user',
      uuid: 'u1',
      message: { role: 'user', content: 'the marker is\n@@HERDRCHAT ghost\nand that is all' },
    });
    const subject = new TranscriptStore(new MarkerTransport(`${poison}\n`));
    const result = await subject.latestMessages([
      { workspaceId: 'w1', cwd: '/srv/app', sessionId: 'sess-a' },
    ]);

    expect([...result.keys()]).toEqual(['w1']);
    expect(result.has('ghost')).toBe(false);
  });
});
