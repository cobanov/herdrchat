import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';

import { HerdrError } from '../herdr/protocol';
import { HerdrSocket, isSocketProbe } from '../herdr/socket';
import type { Duplex, HerdrTransport } from '../herdr/transport';

/** A host whose bridge is a stdin/stdout pair the test drives by hand. */
function fakeHost(options: { startFails?: boolean; startHangs?: boolean } = {}) {
  const execs: string[] = [];
  const bridges: { written: string[]; answer: (line: string) => void; end: () => void; signal?: AbortSignal }[] = [];
  const transport: HerdrTransport = {
    exec: async (command) => {
      execs.push(command);
      const stdout = isSocketProbe(command) ? 'BRIDGE python3\nSOCK /tmp/h.sock\n' : '{"id":"x","result":{"via":"exec"}}';
      return { ok: true, exitCode: 0, stdout, stderr: '' } as never;
    },
    streamLines: async function* () {},
    duplex: (_command, _startTimeoutMs, signal) => {
      const queue: string[] = [];
      let done = false;
      let wake: (() => void) | null = null;
      const bridge = {
        written: [] as string[],
        answer: (line: string) => { queue.push(line); wake?.(); },
        end: () => { done = true; wake?.(); },
        signal,
      };
      bridges.push(bridge);
      const lines = (async function* () {
        while (!done || queue.length > 0) {
          const line = queue.shift();
          if (line !== undefined) yield line;
          else await new Promise<void>((resolve) => (wake = resolve));
        }
      })();
      return {
        lines,
        started: options.startHangs
          ? new Promise<void>(() => {})
          : options.startFails ? Promise.reject(new Error('no channel')) : Promise.resolve(),
        write: async (text: string) => {
          if (done) return false;
          bridge.written.push(text);
          return true;
        },
      };
    },
  };
  return { socket: new HerdrSocket(transport, 'herdr'), execs: () => execs.filter((c) => !isSocketProbe(c)), bridges };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
/** The tag the bridge was handed with the `index`th request. */
const tagOf = (written: string) => written.slice(0, written.indexOf('\t'));

describe('the kept-open bridge', () => {
  it('sends every request down one bridge and gives each its own answer, in any order', async () => {
    const { socket, execs, bridges } = fakeHost();
    const first = socket.call('pane.read', { pane_id: 'p1' }, 1000);
    const second = socket.call('pane.read', { pane_id: 'p2' }, 1000);
    await tick();
    expect(bridges).toHaveLength(1);
    const [a, b] = bridges[0]!.written;
    expect(JSON.parse(a!.slice(a!.indexOf('\t') + 1))).toMatchObject({ method: 'pane.read', params: { pane_id: 'p1' } });
    bridges[0]!.answer(`${tagOf(b!)}\t{"id":"2","result":{"pane":"p2"}}`);
    bridges[0]!.answer(`${tagOf(a!)}\t{"id":"1","result":{"pane":"p1"}}`);
    await expect(first).resolves.toEqual({ pane: 'p1' });
    await expect(second).resolves.toEqual({ pane: 'p2' });
    expect(execs()).toEqual([]);
  });

  it('answers a batch entry by entry, a refusal as that entry alone', async () => {
    const { socket, bridges } = fakeHost();
    const answers = socket.callEach('pane.process_info', [{ pane_id: 'p1' }, { pane_id: 'p2' }], 1000);
    await tick();
    const [a, b] = bridges[0]!.written;
    bridges[0]!.answer(`${tagOf(a!)}\t{"id":"1","result":{"name":"zsh"}}`);
    bridges[0]!.answer(`${tagOf(b!)}\t{"id":"2","error":{"code":"pane_not_found","message":"gone"}}`);
    const [ok, refused] = await answers;
    expect(ok).toEqual({ ok: true, result: { name: 'zsh' } });
    expect(refused?.ok === false ? refused.error.code : null).toBe('pane_not_found');
  });

  it('times a silent request out as the transport, since nobody knows if it landed', async () => {
    const { socket } = fakeHost();
    const thrown = await socket.call('agent.prompt', {}, 20).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(HerdrError);
    expect((thrown as HerdrError).code).toBe('timeout');
    expect((thrown as HerdrError).transport).toBe(true);
  });

  it('fails what is waiting when the bridge ends, and starts another for the next request', async () => {
    const { socket, bridges } = fakeHost();
    const waiting = socket.call('pane.read', {}, 1000);
    await tick();
    bridges[0]!.end();
    await expect(waiting).rejects.toMatchObject({ code: 'transport_failed' });
    const next = socket.call('pane.read', {}, 1000);
    await tick();
    expect(bridges).toHaveLength(2);
    bridges[1]!.answer(`${tagOf(bridges[1]!.written[0]!)}\t{"id":"1","result":{"ok":1}}`);
    await expect(next).resolves.toEqual({ ok: 1 });
  });

  it('execs once three bridges in a row ended without one answer', async () => {
    const { socket, execs, bridges } = fakeHost();
    for (let round = 0; round < 3; round += 1) {
      const waiting = socket.call('pane.read', {}, 1000).catch(() => null);
      await tick();
      bridges[round]!.end();
      await waiting;
    }
    await expect(socket.call('pane.read', {}, 1000)).resolves.toEqual({ via: 'exec' });
    expect(bridges).toHaveLength(3);
    expect(execs()).toHaveLength(1);
  });

  // A half-open connection: the exec path dropped the SSH client when an exec
  // ran past its deadline. A bridge that kept going would make every later
  // request wait out its own deadline until TCP gave up.
  it('ends a bridge whose request timed out, closing its channel, and starts another for the next', async () => {
    const { socket, bridges } = fakeHost();
    const other = socket.call('pane.read', { pane_id: 'p2' }, 1000);
    await expect(socket.call('agent.prompt', {}, 20)).rejects.toMatchObject({ code: 'timeout' });
    expect(bridges[0]!.signal?.aborted).toBe(true);
    await expect(other).rejects.toMatchObject({ code: 'transport_failed' });
    const next = socket.call('pane.read', {}, 1000);
    await tick();
    expect(bridges).toHaveLength(2);
    bridges[1]!.answer(`${tagOf(bridges[1]!.written[0]!)}\t{"id":"1","result":{"ok":1}}`);
    await expect(next).resolves.toEqual({ ok: 1 });
  });

  it("waits for a bridge's start no longer than the call's own deadline", async () => {
    const { socket, execs } = fakeHost({ startHangs: true });
    const thrown = await socket.call('pane.read', {}, 30).catch((error: unknown) => error);
    expect(thrown).toMatchObject({ code: 'timeout', transport: true });
    expect(execs()).toEqual([]);
  });

  it('tries a bridge again five minutes after three ended without one answer', async () => {
    const now = jest.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_000_000);
      const { socket, bridges } = fakeHost();
      for (let round = 0; round < 3; round += 1) {
        const waiting = socket.call('pane.read', {}, 1000).catch(() => null);
        await tick();
        bridges[round]!.end();
        await waiting;
      }
      await expect(socket.call('pane.read', {}, 1000)).resolves.toEqual({ via: 'exec' });
      now.mockReturnValue(1_000_000 + 5 * 60_000);
      const next = socket.call('pane.read', {}, 1000);
      await tick();
      expect(bridges).toHaveLength(4);
      bridges[3]!.answer(`${tagOf(bridges[3]!.written[0]!)}\t{"id":"1","result":{"ok":1}}`);
      await expect(next).resolves.toEqual({ ok: 1 });
    } finally {
      now.mockRestore();
    }
  });

  it('execs a request whose bridge could not start, so nothing is lost', async () => {
    const { socket, execs } = fakeHost({ startFails: true });
    await expect(socket.call('pane.read', {}, 1000)).resolves.toEqual({ via: 'exec' });
    expect(execs()).toHaveLength(1);
  });
});

/**
 * The real host side: `LIVE_BRIDGE` under python3, run by `sh -c` as sshd
 * would, against a Unix socket that answers like herdr (one request, one line,
 * per connection).
 */
describe('the bridge on a host', () => {
  let dir: string;
  let server: Server;
  let socketPath: string;

  beforeAll(async () => {
    // Not tmpdir(): a Unix socket path is at most 104 bytes on macOS, and TMPDIR can be longer.
    dir = mkdtempSync('/tmp/hcb-');
    socketPath = join(dir, 'herdr.sock');
    server = createServer((connection) => {
      let buffer = '';
      connection.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        if (!buffer.includes('\n')) return;
        const request = JSON.parse(buffer) as { id: string; params: { text?: string; delayMs?: number } };
        setTimeout(() => connection.end(`${JSON.stringify({ id: request.id, result: { echo: request.params.text } })}\n`),
          request.params.delayMs ?? 0);
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  /** A host reached by `sh -c`, whose probe names `sock`. */
  function shellHost(sock: string) {
    const children: ReturnType<typeof spawn>[] = [];
    const transport: HerdrTransport = {
      exec: async () => ({ ok: true, exitCode: 0, stdout: `BRIDGE python3\nSOCK ${sock}\n`, stderr: '' }) as never,
      streamLines: async function* () {},
      duplex: (command): Duplex => {
        const child = spawn('sh', ['-c', command]);
        children.push(child);
        const queue: string[] = [];
        let done = false;
        let wake: (() => void) | null = null;
        let buffer = '';
        child.stdout.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          const parts = buffer.split('\n');
          buffer = parts.pop() ?? '';
          queue.push(...parts);
          wake?.();
        });
        child.on('close', () => { done = true; wake?.(); });
        return {
          lines: (async function* () {
            while (!done || queue.length > 0) {
              const line = queue.shift();
              if (line !== undefined) yield line;
              else await new Promise<void>((resolve) => (wake = resolve));
            }
          })(),
          started: Promise.resolve(),
          write: async (text) => !done && child.stdin.write(text) !== undefined,
        };
      },
    };
    return { socket: new HerdrSocket(transport, 'herdr'), stop: () => children.forEach((child) => child.kill()) };
  }

  it('answers each request on its own, so a slow one holds up no other, and keeps an emoji whole', async () => {
    const { socket, stop } = shellHost(socketPath);
    try {
      const slow = socket.call('agent.prompt', { text: 'slow', delayMs: 400 }, 5000);
      const started = Date.now();
      await expect(socket.call('pane.read', { text: 'Merhaba 👋 çay' }, 5000)).resolves.toEqual({ echo: 'Merhaba 👋 çay' });
      expect(Date.now() - started).toBeLessThan(300);
      await expect(slow).resolves.toEqual({ echo: 'slow' });
    } finally {
      stop();
    }
  });

  it('says herdr is not running when the socket is not there', async () => {
    const { socket, stop } = shellHost(join(dir, 'missing.sock'));
    try {
      await expect(socket.call('pane.read', {}, 5000)).rejects.toMatchObject({ code: 'server_not_running' });
    } finally {
      stop();
    }
  });
});
