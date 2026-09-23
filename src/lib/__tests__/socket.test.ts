import { HerdrError } from '../herdr/protocol';
import {
  HerdrSocket,
  MAX_COMMAND_BYTES,
  base64,
  commandFor,
  decodeEvent,
  parseProbe,
  probeScript,
} from '../herdr/socket';
import type { HerdrTransport } from '../herdr/transport';

const PYTHON_PROBE = 'BRIDGE python3\nSOCK /home/u/.config/herdr/herdr.sock\n';

/**
 * A host whose probe prints `probe`, and which answers every other command
 * with `reply`, recording what it was asked to run.
 */
function host(probe: string, reply: string | (() => Promise<string>)) {
  const commands: string[] = [];
  const transport: HerdrTransport = {
    exec: async (command: string) => {
      commands.push(command);
      const isProbe = command.includes('BRIDGE');
      const stdout = isProbe ? probe : typeof reply === 'string' ? reply : await reply();
      return { ok: true, exitCode: 0, stdout, stderr: '' } as never;
    },
    streamLines: async function* () {},
  };
  return { transport, commands, socket: new HerdrSocket(transport, 'herdr') };
}

const requests = (commands: string[]) => commands.filter((c) => !c.includes('BRIDGE'));

describe('probe', () => {
  it('reads the bridge and the socket path', () => {
    expect(parseProbe(PYTHON_PROBE)).toEqual({
      bridge: 'python3',
      socketPath: '/home/u/.config/herdr/herdr.sock',
    });
    expect(parseProbe('BRIDGE api-bridge\nSOCK /tmp/h.sock')).toEqual({
      bridge: 'api-bridge',
      socketPath: '/tmp/h.sock',
    });
  });

  it('is null when the host has no bridge, or said something else', () => {
    expect(parseProbe('BRIDGE none\nSOCK /tmp/h.sock')).toBeNull();
    expect(parseProbe('BRIDGE python3\n')).toBeNull();
    expect(parseProbe('bash: herdr: command not found')).toBeNull();
  });

  it('asks herdr for the socket path before falling back to the default', () => {
    const script = probeScript('herdr');
    expect(script.indexOf("'herdr' status server")).toBeLessThan(script.indexOf('HERDR_SOCKET_PATH'));
  });

  it("only trusts Apple's python stub when the developer tools are installed", () => {
    // The stub pops a dialog on the host's screen otherwise.
    expect(probeScript('herdr')).toContain('xcode-select -p');
  });

  it('runs once per socket, not once per call', async () => {
    const { socket, commands } = host(PYTHON_PROBE, '{"id":"x","result":{"type":"pong"}}');
    await socket.call('ping', {}, 1000);
    await socket.call('ping', {}, 1000);
    await socket.call('ping', {}, 1000);
    expect(commands.filter((c) => c.includes('BRIDGE'))).toHaveLength(1);
    expect(requests(commands)).toHaveLength(3);
  });

  it('does not memoise a probe that never reached the host', async () => {
    let attempts = 0;
    const transport: HerdrTransport = {
      exec: async (command: string) => {
        if (command.includes('BRIDGE')) {
          attempts += 1;
          if (attempts === 1) return { ok: false, code: 'connect_failed', message: 'down' } as never;
          return { ok: true, exitCode: 0, stdout: PYTHON_PROBE, stderr: '' } as never;
        }
        return { ok: true, exitCode: 0, stdout: '{"id":"x","result":{}}', stderr: '' } as never;
      },
      streamLines: async function* () {},
    };
    const socket = new HerdrSocket(transport, 'herdr');
    expect(await socket.detect()).toBeNull();
    expect(await socket.detect()).toEqual({
      bridge: 'python3',
      socketPath: '/home/u/.config/herdr/herdr.sock',
    });
    expect(attempts).toBe(2);
  });
});

describe('call', () => {
  it('sends one JSON line with an id, a method and params, and unwraps the result', async () => {
    const { socket, commands } = host(
      PYTHON_PROBE,
      '{"id":"hc:agent.list:1","result":{"type":"agents","agents":[]}}'
    );
    const result = await socket.call('agent.list', {}, 1000);
    expect(result).toEqual({ type: 'agents', agents: [] });
    const command = requests(commands)[0] ?? '';
    expect(command).toContain('python3 -S -c');
    expect(command).toContain("'/home/u/.config/herdr/herdr.sock'");
    expect(command).toContain(`'{"id":"hc:agent.list:1","method":"agent.list","params":{}}'`);
  });

  it("surfaces the server's own error code", async () => {
    const { socket } = host(
      PYTHON_PROBE,
      '{"id":"x","error":{"code":"agent_not_ready","message":"agent w1:p1 is not an active named agent"}}'
    );
    await expect(socket.call('agent.prompt', { target: 'w1:p1', text: 'hi' }, 1000)).rejects.toMatchObject({
      code: 'agent_not_ready',
    });
  });

  it('reports a host without a bridge as socket_unavailable, so the client can fall back', async () => {
    const { socket, commands } = host('BRIDGE none\nSOCK /tmp/h.sock', '');
    await expect(socket.call('ping', {}, 1000)).rejects.toMatchObject({ code: 'socket_unavailable' });
    expect(requests(commands)).toHaveLength(0);
  });

  it('turns a connect failure printed by the bridge into herdr_not_running wording', async () => {
    const transport: HerdrTransport = {
      exec: async (command: string) => {
        if (command.includes('BRIDGE')) return { ok: true, exitCode: 0, stdout: PYTHON_PROBE, stderr: '' } as never;
        return {
          ok: true,
          exitCode: 1,
          stdout:
            '{"id":"bridge","error":{"code":"server_not_running","message":"herdr socket /x: Connection refused"}}\n',
          stderr: '',
        } as never;
      },
      streamLines: async function* () {},
    };
    const socket = new HerdrSocket(transport, 'herdr');
    await expect(socket.call('ping', {}, 1000)).rejects.toMatchObject({ code: 'server_not_running' });
  });

  it('quotes the request so shell metacharacters in a prompt are inert', () => {
    const route = { bridge: 'python3', socketPath: '/tmp/h.sock' } as const;
    const request = JSON.stringify({
      id: 'x',
      method: 'agent.prompt',
      params: { target: 'w1:p1', text: `rm -rf $HOME; echo 'it''s' \`whoami\` "q"` },
    });
    const command = commandFor(route, request, 'herdr');
    // Everything user-controlled sits inside one single-quoted argument.
    expect(command).toContain(`'${request.replaceAll("'", `'\\''`)}'`);
  });

  it('refuses a request the host could not accept as one argument', () => {
    const route = { bridge: 'python3', socketPath: '/tmp/h.sock' } as const;
    const huge = JSON.stringify({ id: 'x', method: 'agent.prompt', params: { text: 'a'.repeat(MAX_COMMAND_BYTES) } });
    expect(() => commandFor(route, huge, 'herdr')).toThrow(HerdrError);
  });

  // #105: the check was on the request, before base64 and quoting grew it.
  it('counts what the route adds: base64 on the fork bridge', () => {
    const route = { bridge: 'api-bridge', socketPath: '/tmp/h.sock' } as const;
    const request = JSON.stringify({ id: 'x', method: 'agent.prompt', params: { text: 'a'.repeat(100 * 1024) } });
    expect(() => commandFor(route, request, 'herdr')).toThrow(HerdrError);
    const python = { bridge: 'python3', socketPath: '/tmp/h.sock' } as const;
    expect(() => commandFor(python, request, 'herdr')).not.toThrow();
  });

  it('counts what the route adds: quoting of single quotes', () => {
    const route = { bridge: 'python3', socketPath: '/tmp/h.sock' } as const;
    const request = JSON.stringify({ id: 'x', method: 'agent.prompt', params: { text: "'".repeat(40 * 1024) } });
    expect(() => commandFor(route, request, 'herdr')).toThrow(HerdrError);
  });

  it('hands the fork bridge base64 of the UTF-8 bytes', () => {
    const route = { bridge: 'api-bridge', socketPath: '/tmp/h.sock' } as const;
    const request = '{"id":"x","method":"ping","params":{"note":"çay ☕"}}';
    const command = commandFor(route, request, '/opt/herdr');
    expect(command).toContain(`'/opt/herdr' api-bridge ${Buffer.from(request, 'utf8').toString('base64')}`);
  });
});

describe('base64', () => {
  it.each(['', 'a', 'ab', 'abc', 'abcd', 'çay ☕ 🚀', '{"x":"/"}'])('matches Buffer for %j', (text) => {
    expect(base64(text)).toBe(Buffer.from(text, 'utf8').toString('base64'));
  });
});

describe('subscribe', () => {
  function streamingHost(lines: string[]) {
    const transport: HerdrTransport = {
      exec: async () => ({ ok: true, exitCode: 0, stdout: PYTHON_PROBE, stderr: '' }) as never,
      streamLines: async function* () {
        yield* lines;
      },
    };
    return new HerdrSocket(transport, 'herdr');
  }

  it('reports subscription_started once, then yields events and refusals', async () => {
    const socket = streamingHost([
      '{"id":"hc:events.subscribe:1","result":{"type":"subscription_started"}}',
      '',
      '{"data":{"agent":"claude","agent_status":"working","pane_id":"w1:p1","turn":0},"event":"pane.agent_status_changed"}',
      '{"id":"hc:events.subscribe:1:sub:1:probe","error":{"code":"pane_not_found","message":"pane w9:p1 not found"}}',
      '{"data":{"turn":1,"outcome":"completed","pane":{"pane_id":"w1:p1"}},"event":"pane.turn_completed"}',
    ]);
    const events = [];
    for await (const event of socket.subscribe([{ type: 'pane.agent_status_changed', pane_id: 'w1:p1' }], 1000)) {
      events.push(event);
    }
    expect(events).toEqual([
      { kind: 'started' },
      {
        kind: 'event',
        event: 'pane.agent_status_changed',
        data: { agent: 'claude', agent_status: 'working', pane_id: 'w1:p1', turn: 0 },
      },
      { kind: 'refused', code: 'pane_not_found', message: 'pane w9:p1 not found' },
      {
        kind: 'event',
        event: 'pane.turn_completed',
        data: { turn: 1, outcome: 'completed', pane: { pane_id: 'w1:p1' } },
      },
    ]);
  });

  it('throws when the stream ends before the subscription started (#104)', async () => {
    const socket = streamingHost([]);
    const consume = async () => {
      const seen = [];
      for await (const event of socket.subscribe([{ type: 'workspace.created' }], 1000)) seen.push(event);
      return seen;
    };
    await expect(consume()).rejects.toMatchObject({ code: 'subscription_ended' });
  });

  it('throws when the server refuses the subscription outright', async () => {
    const socket = streamingHost([
      '{"id":"hc:events.subscribe:1","error":{"code":"invalid_request","message":"unknown variant"}}',
    ]);
    const iterate = async () => {
      for await (const event of socket.subscribe([{ type: 'nope' }], 1000)) {
        throw new Error(`unexpected ${event.kind}`);
      }
    };
    await expect(iterate()).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('ignores a line that is neither an event nor an error', () => {
    expect(decodeEvent('not json')).toBeNull();
    expect(decodeEvent('{"id":"x","result":{"type":"pong"}}')).toBeNull();
  });
});

// herdr 0.9.1's own bridge, for hosts without python3 (#116).
describe('remote-api-bridge', () => {
  const REMOTE_PROBE = 'BRIDGE remote-api-bridge\nSOCK /home/u/.config/herdr/herdr.sock\n';

  it('is found by its capability line, after the other two', () => {
    expect(parseProbe(REMOTE_PROBE)?.bridge).toBe('remote-api-bridge');
    const script = probeScript('herdr');
    expect(script).toContain("remote-api-bridge --check </dev/null 2>/dev/null)\" = herdr-api-bridge-v1");
    expect(script.indexOf('b=python3')).toBeLessThan(script.indexOf('b=remote-api-bridge'));
  });

  // The server takes the end of stdin as the client leaving: a subscription
  // stopped at once, and a waiting request answered nothing. The command has
  // to keep stdin open, and still end as soon as the bridge does.
  it('keeps stdin open for the bridge and ends when the bridge does', () => {
    const { execFileSync } = jest.requireActual<typeof import('node:child_process')>('node:child_process');
    const { mkdtempSync, writeFileSync, chmodSync, rmSync } = jest.requireActual<typeof import('node:fs')>('node:fs');
    const { tmpdir } = jest.requireActual<typeof import('node:os')>('node:os');
    const dir = mkdtempSync(`${tmpdir()}/hc-bridge-`);
    const fake = `${dir}/herdr`;
    // Answers the request, then reports whether stdin was still open.
    // Python rather than bash: macOS ships bash 3.2, where a `read -t` timeout
    // and end of input return the same status.
    writeFileSync(fake, [
      '#!/usr/bin/env python3',
      'import json, os, select, sys',
      'if sys.argv[1:] != ["remote-api-bridge"]: sys.exit(2)',
      'data = b""',
      'while not data.endswith(b"\\n"):',
      '    chunk = os.read(0, 4096)',
      '    if not chunk: break',
      '    data += chunk',
      'ready = select.select([0], [], [], 1.0)[0]',
      'held = "open" if not ready else ("closed" if os.read(0, 1) == b"" else "data")',
      'print(json.dumps({"id": "1", "result": {"type": "echo", "stdin": held, "got": json.loads(data)}}))',
    ].join('\n'));
    chmodSync(fake, 0o755);
    try {
      const command = commandFor({ bridge: 'remote-api-bridge', socketPath: '/unused' }, '{"id":"1","method":"ping"}', fake);
      const started = Date.now();
      const out = execFileSync('sh', ['-c', command], { encoding: 'utf8', timeout: 10_000 });
      expect(JSON.parse(out)).toEqual({ id: '1', result: { type: 'echo', stdin: 'open', got: { id: '1', method: 'ping' } } });
      // The holder sleeps for years; the command must not wait for it.
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads a missing socket from the bridge's stderr as herdr not running", async () => {
    const transport: HerdrTransport = {
      exec: async (command: string) =>
        (command.includes('BRIDGE')
          ? { ok: true, exitCode: 0, stdout: REMOTE_PROBE, stderr: '' }
          : {
              ok: true,
              exitCode: 1,
              stdout: '',
              stderr: 'Error: Custom { kind: NotFound, error: "failed to connect to remote Herdr API socket /home/u/.config/herdr/herdr.sock: No such file or directory (os error 2)" }',
            }) as never,
      streamLines: async function* () {},
    };
    const socket = new HerdrSocket(transport, 'herdr');
    await expect(socket.call('ping', {}, 1000)).rejects.toMatchObject({ code: 'server_not_running' });
  });
});
