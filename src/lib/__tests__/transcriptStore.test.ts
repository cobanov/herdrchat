import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

    // `older()`'s line-start probe: the byte offset of the last line in the
    // first N bytes, which is what `grep -b '' | cut | tail -n 1` prints.
    const probe = /head -c (\d+) .*grep -a -b/.exec(command);
    if (probe !== null) {
      const prefix = bytes.subarray(0, Number(probe[1]));
      const lastNewlineBeforeEnd = prefix.subarray(0, prefix.length - 1).lastIndexOf(0x0a);
      return ok(`${lastNewlineBeforeEnd + 1}\n`);
    }

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

function store(file: string): { store: TranscriptStore; transport: FakeTransport } {
  const transport = new FakeTransport(file);
  return { store: new TranscriptStore(transport), transport };
}

/**
 * A host made of the real `sh`, `head`, `tail`, `grep` and `sed`, reading a
 * real file. The window reads run a script on the host, and a canned answer
 * would only test the canned answer: this runs BSD tools on a Mac and GNU ones
 * on the CI runner, which are exactly the two the script must agree across.
 */
class ShellHost implements HerdrTransport {
  readonly path: string;
  readonly outputs: string[] = [];

  constructor(contents: string) {
    this.path = join(mkdtempSync(join(tmpdir(), 'herdrchat-')), 't.jsonl');
    writeFileSync(this.path, contents);
  }

  append(text: string): void {
    appendFileSync(this.path, text);
  }

  async exec(command: string): Promise<ExecResult> {
    const run = spawnSync('/bin/sh', ['-c', command], { maxBuffer: 64 * 1024 * 1024 });
    const stdout = run.stdout.toString('utf8');
    this.outputs.push(stdout);
    return { ok: true, stdout, stderr: run.stderr.toString('utf8'), exitCode: run.status ?? 1 };
  }

  async *streamLines(command: string): AsyncIterable<string> {
    const from = /tail -c \+(\d+)/.exec(command);
    const start = from === null ? 0 : Number(from[1]) - 1;
    for (const line of readFileSync(this.path).subarray(start).toString('utf8').split('\n')) {
      if (line.length > 0) yield line;
    }
  }
}

function shellStore(contents: string): { store: TranscriptStore; host: ShellHost } {
  const host = new ShellHost(contents);
  return { store: new TranscriptStore(host), host };
}

/** Where line `index` of `file` starts, in bytes. */
function lineStart(file: string, index: number): number {
  return Buffer.byteLength(file.split('\n').slice(0, index).map((line) => `${line}\n`).join(''), 'utf8');
}

describe('recent window', () => {
  it('opens on the newest lines', async () => {
    const file = transcript(500);
    const { store: subject, host } = shellStore(file);
    const result = await subject.recent(host.path, null, 20);

    expect(result.messages.map((message) => displayText(message))).toEqual(
      Array.from({ length: 20 }, (_, index) => `turn ${480 + index}`)
    );
    expect(result.consumedBytes).toBe(Buffer.byteLength(file, 'utf8'));
    expect(result.startByte).toBe(lineStart(file, 480));
  });

  it('leaves a partial final line for the tail to complete', async () => {
    const complete = transcript(3);
    const partial = '{"type":"user","uuid":"next","message":{"role":"user","content":"';
    const { store: subject, host } = shellStore(complete + partial);
    const recent = await subject.recent(host.path, null, 150);

    expect(recent.messages).toHaveLength(3);
    expect(recent.consumedBytes).toBe(Buffer.byteLength(complete));
    host.append('arrived 🎉"}}\n');
    const messages: string[] = [];
    for await (const chunk of subject.tail(host.path, null, recent.consumedBytes)) {
      if (chunk.message !== null) messages.push(displayText(chunk.message));
    }
    expect(messages).toEqual(['arrived 🎉']);
  });

  it('stops at the probed size even if the transcript has grown since', async () => {
    const initial = transcript(3);
    const { store: subject, host } = shellStore(initial);
    host.append(transcript(50).replaceAll('"u', '"later-u'));
    const recent = await subject.recent(host.path, null, 150, Buffer.byteLength(initial));

    expect(recent.messages).toHaveLength(3);
    expect(recent.consumedBytes).toBe(Buffer.byteLength(initial));
  });

  it('reads a short transcript whole', async () => {
    const file = transcript(6);
    const { store: subject, host } = shellStore(file);
    const result = await subject.recent(host.path, null, 150);

    expect(result.messages).toHaveLength(6);
    expect(result.startByte).toBe(0);
    expect(result.consumedBytes).toBe(Buffer.byteLength(file, 'utf8'));
  });

  it('reads an empty transcript as nothing', async () => {
    const { store: subject, host } = shellStore('');
    const result = await subject.recent(host.path, null, 150);

    expect(result).toEqual({ messages: [], consumedBytes: 0, startByte: 0 });
  });

  // Offsets are BYTE offsets on the host. Counting UTF-16 units would drift the
  // tail cursor on any transcript containing an emoji or a non-Latin script,
  // and the drift silently skips messages.
  it('accounts in bytes, not characters', async () => {
    const emoji = `{"type":"user","uuid":"e0","message":{"role":"user","content":"herşey 🎉 tamam"}}\n`;
    const file = emoji + transcript(3);
    const { store: subject, host } = shellStore(file);
    const result = await subject.recent(host.path, null, 3);

    expect(result.consumedBytes).toBe(Buffer.byteLength(file, 'utf8'));
    expect(result.startByte).toBe(Buffer.byteLength(emoji, 'utf8'));
    expect(result.startByte).toBeGreaterThan(emoji.length);
  });

  // The reported bug: Claude embeds every picture it reads as base64, twice, so
  // a byte window over a screenshot-heavy session held a picture or two and
  // almost no conversation. The host strips the data before it is sent.
  it('leaves picture data on the host and keeps the picture', async () => {
    const data = 'iVBORw0KGgo'.repeat(40_000);
    const picture = JSON.stringify({
      type: 'user',
      uuid: 'pic',
      message: {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
          { type: 'text', text: 'look at this' },
        ],
      },
    });
    const codex = JSON.stringify({ type: 'note', image_url: `data:image/png;base64,${data}` });
    const file = `${transcript(2)}${picture}\n${codex}\n`;
    const { store: subject, host } = shellStore(file);
    const result = await subject.recent(host.path, null, 150);

    expect(host.outputs.at(-1)!.length).toBeLessThan(2_000);
    const sent = result.messages.find((message) => message.id === 'pic')!;
    expect(displayText(sent)).toBe('look at this');
    expect(sent.segments.filter((segment) => segment.kind === 'image')).toHaveLength(1);
    expect(result.consumedBytes).toBe(Buffer.byteLength(file, 'utf8'));
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
  it('returns the lines immediately before the anchor', async () => {
    const file = transcript(200);
    const { store: subject, host } = shellStore(file);

    const first = await subject.recent(host.path, null, 30);
    const page = await subject.older(host.path, null, first.startByte, 25);

    expect(page.messages.map((message) => displayText(message))).toEqual(
      Array.from({ length: 25 }, (_, index) => `turn ${145 + index}`)
    );
    expect(page.startByte).toBe(lineStart(file, 145));
    expect(page.reachedStart).toBe(false);
  });

  // The invariant that matters: paging to the top must show every turn exactly
  // once. An anchor off by one line either repeats a message or loses one, and
  // both look like a rendering glitch rather than a byte-accounting bug.
  it('pages to the start of the file with no gaps and no repeats', async () => {
    const file = `{"type":"user","uuid":"e","message":{"role":"user","content":"turn 🙂"}}\n${transcript(200)}`;
    const { store: subject, host } = shellStore(file);

    const first = await subject.recent(host.path, null, 30);
    const seen = first.messages.map((message) => message.id);

    let anchor = first.startByte;
    for (let guard = 0; ; guard += 1) {
      const page = await subject.older(host.path, null, anchor, 17);
      seen.unshift(...page.messages.map((message) => message.id));
      if (page.reachedStart) break;
      expect(page.startByte).toBeLessThan(anchor); // must always make progress
      anchor = page.startByte;
      if (guard > 100) throw new Error('older() never reached the start');
    }

    expect(seen).toEqual(['e', ...Array.from({ length: 200 }, (_, index) => `u${index}`)]);
  });

  // #81: a line longer than a byte page (image results, tool dumps) once handed
  // back the same anchor, and paging stopped there for good. Pages are lines
  // now, so such a line is one line among the rest.
  it('pages past a line of any length', async () => {
    const big = `{"type":"user","uuid":"big","message":{"role":"user","content":"${'x y'.repeat(300_000)}"}}`;
    const lines = [
      ...Array.from({ length: 5 }, (_, i) => `{"type":"user","uuid":"a${i}","message":{"role":"user","content":"turn ${i}"}}`),
      big,
      ...Array.from({ length: 5 }, (_, i) => `{"type":"user","uuid":"b${i}","message":{"role":"user","content":"turn ${i + 6}"}}`),
    ];
    const { store: subject, host } = shellStore(`${lines.join('\n')}\n`);

    const first = await subject.recent(host.path, null, 3);
    const ids = first.messages.map((message) => message.id);
    let anchor = first.startByte;
    for (let guard = 0; ; guard += 1) {
      const page = await subject.older(host.path, null, anchor, 2);
      ids.unshift(...page.messages.map((message) => message.id));
      if (page.reachedStart) break;
      anchor = page.startByte;
      if (guard > 20) throw new Error('older() stopped making progress');
    }
    expect(ids).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'big', 'b0', 'b1', 'b2', 'b3', 'b4']);
  });

  it('refuses an answer without its byte range', async () => {
    const garbled: HerdrTransport = {
      exec: async () => ok('{"type":"user"'),
      streamLines: async function* () {},
    };
    await expect(new TranscriptStore(garbled).older('/t.jsonl', null, 500, 20)).rejects.toMatchObject({
      code: 'transcript_changed',
    });
  });

  it('fails rather than reading a missing transcript as empty history', async () => {
    const { store: subject, host } = shellStore(transcript(3));
    await expect(subject.older(`${host.path}.gone`, null, 100, 20)).rejects.toBeDefined();
  });

  it('reports reaching the start rather than paging forever', async () => {
    const file = transcript(5);
    const { store: subject, host } = shellStore(file);
    const page = await subject.older(host.path, null, lineStart(file, 2), 10);

    expect(page.messages.map((message) => message.id)).toEqual(['u0', 'u1']);
    expect(page.reachedStart).toBe(true);
    expect(page.startByte).toBe(0);
  });

  it('does nothing at the start of the file', async () => {
    const { store: subject, transport } = store(transcript(5));
    const page = await subject.older('/t.jsonl', null, 0, 10);

    expect(page.messages).toEqual([]);
    expect(page.reachedStart).toBe(true);
    // Not even a round-trip: there is nothing before byte zero to ask for.
    expect(transport.commands).toHaveLength(0);
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
    expect(chunks[1]?.meta).toEqual({ model: 'claude-opus-4-8', effort: null, contextTokens: 25_000 });
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
 * `fileProbe` has to answer three questions, not two — and it has now got that
 * wrong from both directions.
 *
 * It first returned `-1` for both "no such file" and "the read failed", with
 * `2>/dev/null` discarding the only evidence that separated them. Then it
 * matched English stderr, which broke on any localized host. Then `[ -f ]`,
 * which is a stat and so answers false both for "not there" and for "not
 * allowed to look" — putting permission failures back into `absent`, the branch
 * callers retry in silence.
 *
 * `absent` is the expensive one to get wrong: it costs a thread that waits
 * forever and never says why.
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

  it('asks the shell every question rather than reading its stderr', async () => {
    const commands: string[] = [];
    class Recording implements HerdrTransport {
      async exec(command: string): Promise<ExecResult> {
        commands.push(command);
        return ok('12\n');
      }
      async *streamLines(): AsyncIterable<string> {}
    }
    await new TranscriptStore(new Recording()).fileProbe('/home/ada/p/t.jsonl');
    const sent = commands[0] ?? '';
    // `-x` on the folder, not `-r`: reaching a file needs SEARCH permission on
    // the directories above it, and the two are independent.
    expect(sent).toContain("[ -x '/home/ada/p' ]");
    expect(sent).toContain("[ -e '/home/ada/p/t.jsonl' ]");
    expect(sent).toContain("[ -r '/home/ada/p/t.jsonl' ]");
    // `-f` was the whole probe, and it cannot distinguish the two cases below.
    expect(sent).not.toContain('[ -f ');
  });

  // The regression this whole block exists for. `test -f` is false when the
  // path cannot be stat'ed at all, so a directory the SSH account cannot search
  // — a transcript owned by another user, a tightened ~/.claude — reported
  // `absent`, and `absent` is the branch that retries without a word.
  it('reports unknown when the folder cannot be searched', async () => {
    const result = await probe({ ok: true, stdout: '', stderr: '', exitCode: 45 });
    expect(result.kind).toBe('unknown');
    expect(result.kind === 'unknown' && result.reason).toMatch(/folder/i);
  });

  it('reports unknown when the transcript is there but unreadable', async () => {
    const result = await probe({ ok: true, stdout: '', stderr: '', exitCode: 46 });
    expect(result.kind).toBe('unknown');
    expect(result.kind === 'unknown' && result.reason).toMatch(/can't read/i);
  });

  // A project directory that does not exist yet is the same expected case as a
  // file that does not exist yet: Claude creates both when the session starts.
  it('still reports absent when the project folder has not been created', async () => {
    await expect(probe({ ok: true, stdout: '', stderr: '', exitCode: 44 })).resolves.toEqual({
      kind: 'absent',
    });
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

  // Two agents in one workspace: filed by workspace, the second line
  // overwrote the first and one agent's row showed the other's message.
  it('files each request under its own key when one workspace asks twice', async () => {
    const line = JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'hi' } });
    const subject = new TranscriptStore(new MarkerTransport(`${line}\n`));
    const result = await subject.latestMessages([
      { workspaceId: 'w6', key: 'w6:p1', cwd: '/srv/app', sessionId: 'sess-a' },
      { workspaceId: 'w6', key: 'w6:p2', cwd: '/srv/app/web', sessionId: 'sess-b' },
    ]);

    expect([...result.keys()]).toEqual(['w6:p1', 'w6:p2']);
  });
});

/**
 * `$HOME` is looked up once per CONNECTION, and the cache used to claim that
 * while delivering one lookup per call. It lived on the store instance, and no
 * instance survives: `startTail` builds a new store every invocation and
 * `useWorkspaces.refresh` builds one on a three-second poll.
 */
describe('lineStartBefore (#109)', () => {
  const { store: subject } = store('a\nbb\nccc\n');
  it('finds the start of the line that ends at a boundary', async () => {
    await expect(subject.lineStartBefore('/t.jsonl', 5)).resolves.toBe(2);
  });
  it('finds the start of the line a mid-line cursor is in', async () => {
    await expect(subject.lineStartBefore('/t.jsonl', 4)).resolves.toBe(2);
  });
  it('is the start of the file for the first line', async () => {
    await expect(subject.lineStartBefore('/t.jsonl', 1)).resolves.toBe(0);
  });
});

describe('Claude transcript location (#89)', () => {
  const answering = (reply: (command: string) => ExecResult): HerdrTransport => ({
    exec: async (command: string) => reply(command),
    streamLines: async function* () {},
  });

  it('builds the path under the folder Claude Code reports, honouring CLAUDE_CONFIG_DIR', async () => {
    const transport = answering((command) =>
      command.includes('CLAUDE_CONFIG_DIR') ? ok('/data/claude') : ok('')
    );
    await expect(new TranscriptStore(transport).claudeTranscriptPath('/srv/app', 'abc-123')).resolves.toBe(
      '/data/claude/projects/-srv-app/abc-123.jsonl'
    );
  });

  it('refuses an id that is not obviously inert', async () => {
    const store = new TranscriptStore(answering(() => ok('/home/me/.claude')));
    await expect(store.claudeTranscriptPath('/srv', '../../etc/passwd')).resolves.toBeNull();
    await expect(store.findClaudeTranscript("a'; rm -rf /")).resolves.toBeNull();
  });

  it('finds a session filed under another project folder by its exact name only', async () => {
    const commands: string[] = [];
    const store = new TranscriptStore(answering((command) => {
      commands.push(command);
      return ok('/home/me/.claude/projects/-repo--claude-worktrees-fix/abc-123.jsonl');
    }));
    await expect(store.findClaudeTranscript('abc-123')).resolves.toBe(
      '/home/me/.claude/projects/-repo--claude-worktrees-fix/abc-123.jsonl'
    );
    expect(commands[0]).toContain('/projects/*/abc-123.jsonl');
  });

  it('accepts nothing but a file with that exact name', async () => {
    const store = new TranscriptStore(answering(() => ok('/home/me/.claude/projects/x/other.jsonl')));
    await expect(store.findClaudeTranscript('abc-123')).resolves.toBeNull();
  });
});

describe('homeDirectory caching', () => {
  /** Counts `$HOME` lookups and can hold them open to force a concurrent race. */
  class HomeTransport implements HerdrTransport {
    lookups = 0;
    private release: (() => void) | null = null;

    constructor(private readonly hold = false) {}

    async exec(command: string): Promise<ExecResult> {
      if (!command.includes('$HOME')) return ok('');
      this.lookups += 1;
      if (this.hold) {
        await new Promise<void>((resolve) => {
          this.release = resolve;
        });
      }
      return ok('/home/ada\n');
    }

    open(): void {
      this.release?.();
    }

    async *streamLines(): AsyncIterable<string> {
      // not used here
    }
  }

  it('asks the host once for one store', async () => {
    // This was the whole of the coverage, and it passed for the entire time the
    // cache did nothing: one store, called twice, is the only shape in which an
    // instance field works. Nothing in the app calls it that way.
    const transport = new HomeTransport();
    const subject = new TranscriptStore(transport);

    await expect(subject.homeDirectory()).resolves.toBe('/home/ada');
    await expect(subject.homeDirectory()).resolves.toBe('/home/ada');

    expect(transport.lookups).toBe(1);
  });

  it('survives a new store on the same transport', async () => {
    const transport = new HomeTransport();

    await expect(new TranscriptStore(transport).homeDirectory()).resolves.toBe('/home/ada');
    await expect(new TranscriptStore(transport).homeDirectory()).resolves.toBe('/home/ada');
    await expect(new TranscriptStore(transport).homeDirectory()).resolves.toBe('/home/ada');

    expect(transport.lookups).toBe(1);
  });

  it('does not leak one host’s home to another connection', async () => {
    const a = new HomeTransport();
    const b = new HomeTransport();

    await new TranscriptStore(a).homeDirectory();
    await new TranscriptStore(b).homeDirectory();

    expect(a.lookups).toBe(1);
    expect(b.lookups).toBe(1);
  });

  it('collapses concurrent first calls into one round-trip', async () => {
    // The case that made caching the value alone useless: startTail runs once
    // per conversational agent and they all start together, so every miss
    // happens before the first result lands.
    const transport = new HomeTransport(true);

    const all = Promise.all([
      new TranscriptStore(transport).homeDirectory(),
      new TranscriptStore(transport).homeDirectory(),
      new TranscriptStore(transport).homeDirectory(),
    ]);
    transport.open();

    await expect(all).resolves.toEqual(['/home/ada', '/home/ada', '/home/ada']);
    expect(transport.lookups).toBe(1);
  });

  it('retries after a failure instead of caching it forever', async () => {
    // A busy host must not cost the connection its transcripts for good.
    let first = true;
    const transport: HerdrTransport = {
      async exec(command) {
        if (!command.includes('$HOME')) return ok('');
        if (first) {
          first = false;
          return ok('\n');
        }
        return ok('/home/ada\n');
      },
      async *streamLines() {
        // not used here
      },
    };

    await expect(new TranscriptStore(transport).homeDirectory()).rejects.toThrow(
      /home directory/i
    );
    await expect(new TranscriptStore(transport).homeDirectory()).resolves.toBe('/home/ada');
  });
});
