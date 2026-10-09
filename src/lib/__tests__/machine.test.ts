import type { ExecResult } from '../../../modules/herdr-ssh/src';
import { uploadCommands } from '../attachments/upload';
import { HerdrClient } from '../herdr/client';
import {
  jumpCommand,
  jumpStream,
  machineUnreachableMessage,
  sshJump,
  unwrapJump,
  unwrapJumpStream,
  withMachine,
} from '../herdr/machine';
import { withSession } from '../herdr/session';
import { shellQuote, untilChannelCloses, withPath } from '../herdr/shell';
import { JUMP_CONNECT_TIMEOUT_MS, POLL_TIMEOUT_MS } from '../herdr/timeouts';
import type { HerdrTransport } from '../herdr/transport';

const { execFileSync, spawn } = jest.requireActual<typeof import('node:child_process')>('node:child_process');
const { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } =
  jest.requireActual<typeof import('node:fs')>('node:fs');
const { tmpdir } = jest.requireActual<typeof import('node:os')>('node:os');

function recorder(answer: ExecResult = { ok: true, stdout: '', stderr: '', exitCode: 0 }) {
  const calls: { command: string; timeoutMs: number; signal?: AbortSignal }[] = [];
  const transport: HerdrTransport = {
    exec: async (command, timeoutMs) => {
      calls.push({ command, timeoutMs });
      return answer;
    },
    streamLines: async function* (command, timeoutMs, signal) {
      calls.push({ command, timeoutMs, ...(signal === undefined ? {} : { signal }) });
      yield 'line';
    },
  };
  return { transport, calls };
}

/**
 * A host whose `ssh` is a stand-in: it drops the options, the `--` and the
 * destination, and hands the rest to `sh -c`, as sshd hands it to a login
 * shell. `withPath` puts `$HOME/.local/bin` first, so a fake HOME is enough to
 * make the host's shell find it ahead of the real one.
 */
function fakeHost() {
  const home = mkdtempSync(`${tmpdir()}/hc-jump-`);
  mkdirSync(`${home}/.local/bin`, { recursive: true });
  writeFileSync(
    `${home}/.local/bin/ssh`,
    ['#!/bin/sh', 'while [ "$1" != "--" ]; do shift; done', 'shift; shift', 'exec sh -c "$*"', ''].join('\n')
  );
  chmodSync(`${home}/.local/bin/ssh`, 0o755);
  const env = { ...process.env, HOME: home };
  return {
    home,
    env,
    /** Run `command` on the host's shell; returns stdout. */
    run: (command: string) => execFileSync('sh', ['-c', command], { encoding: 'utf8', env }),
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

const PYTHON_BRIDGE = `python3 -S -c ${shellQuote("import sys\nprint('bridge:' + sys.argv[1])")} ${shellQuote("it's $HOME")}`;

describe('sshJump', () => {
  it('runs ssh without a prompt, with a connect timeout and keepalives, and no pty', () => {
    expect(sshJump('klaw', 'herdr api snapshot')).toBe(
      "ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -- 'klaw' 'herdr api snapshot'"
    );
    expect(sshJump('klaw', 'x')).not.toMatch(/ -t\b/);
  });

  it('quotes a target that is not a plain word', () => {
    expect(sshJump("we'ird host", 'x')).toContain(`-- 'we'\\''ird host' 'x'`);
  });

  // What the machine's shell receives must be exactly what the client built,
  // after one more level of quoting and the host's shell taking it off again.
  describe('under a real shell', () => {
    let host: ReturnType<typeof fakeHost>;
    beforeAll(() => {
      host = fakeHost();
    });
    afterAll(() => host.cleanup());

    const inners: [string, string][] = [
      ['single quotes', `printf '%s|' 'it'\\''s' "a 'b'"`],
      ['$HOME, expanded on the machine', `printf '%s' "$HOME"`],
      ['a newline', "printf '%s\\n' one\nprintf '%s\\n' two"],
      ['the python bridge', PYTHON_BRIDGE],
      ['a session export and PATH', withPath(`export HERDR_SESSION='work'; printf '%s' "$HERDR_SESSION"`)],
    ];

    it.each(inners)('keeps %s intact', (_name, inner) => {
      expect(host.run(jumpCommand('nuku', inner))).toBe(host.run(inner));
    });

    it('keeps the python bridge saying what it said', () => {
      expect(host.run(jumpCommand('nuku', PYTHON_BRIDGE))).toBe(`bridge:it's $HOME\n`);
    });

    it('carries a picture chunk through intact, base64 and all', () => {
      const piece = Buffer.from(Array.from({ length: 3072 }, (_, i) => (i * 37) % 256)).toString('base64');
      expect(piece.length).toBe(4096);
      const [first] = uploadCommands('m1-abcdefgh.jpg', piece, 4096);
      host.run(jumpCommand('nuku', first!));
      expect(readFileSync(`${host.home}/.cache/herdrchat/uploads/m1-abcdefgh.jpg.part`, 'utf8')).toBe(piece);
    });
  });
});

describe('unwrapJump', () => {
  it('reads back exactly what was jumped', () => {
    for (const inner of [PYTHON_BRIDGE, "a 'b' c\nd", '', withPath('herdr api snapshot')]) {
      expect(unwrapJump('nuku', jumpCommand('nuku', inner))).toBe(inner);
      expect(unwrapJumpStream('nuku', jumpStream('nuku', inner))).toBe(inner);
    }
  });

  it('answers null for another machine, a host command, or the other shape', () => {
    const jumped = jumpCommand('nuku', 'x');
    expect(unwrapJump('klaw', jumped)).toBeNull();
    expect(unwrapJump('nuku', withPath('herdr api snapshot'))).toBeNull();
    expect(unwrapJump('nuku', `${jumped} extra`)).toBeNull();
    expect(unwrapJump('nuku', jumpStream('nuku', 'x'))).toBeNull();
    expect(unwrapJumpStream('nuku', jumped)).toBeNull();
  });
});

describe('withMachine', () => {
  it('jumps each command and adds the jump to its deadline', async () => {
    const { transport, calls } = recorder();
    await withMachine(transport, 'nuku').exec('herdr api snapshot', POLL_TIMEOUT_MS);
    expect(calls).toEqual([
      { command: jumpCommand('nuku', 'herdr api snapshot'), timeoutMs: POLL_TIMEOUT_MS + JUMP_CONNECT_TIMEOUT_MS },
    ]);
  });

  // Session second, so its export runs on the machine, where its herdr is.
  it('runs the session export on the machine when wrapped machine-first', async () => {
    const { transport, calls } = recorder();
    await withSession(withMachine(transport, 'nuku'), 'work').exec('herdr ping', 1_000);
    expect(calls[0]!.command).toBe(jumpCommand('nuku', "export HERDR_SESSION='work'; herdr ping"));
    expect(calls[0]!.command.startsWith('export HERDR_SESSION')).toBe(false);
  });

  it("reads ssh's own failure as the host not reaching the machine", async () => {
    const { transport } = recorder({ ok: true, stdout: '', stderr: 'ssh: connect to host klaw port 22: Operation timed out', exitCode: 255 });
    const result = await withMachine(transport, 'klaw', { host: 'Gimel', machine: 'klaw' }).exec('x', 1_000);
    expect(result).toEqual({ ok: false, code: 'connect_failed', message: "Gimel can't reach klaw right now." });
    expect(machineUnreachableMessage({ host: 'Gimel', machine: 'klaw' })).toBe("Gimel can't reach klaw right now.");
  });

  it('leaves the machine command’s own failures as they were', async () => {
    const failed: ExecResult = { ok: true, stdout: '', stderr: 'nope', exitCode: 1 };
    await expect(withMachine(recorder(failed).transport, 'klaw').exec('x', 1_000)).resolves.toBe(failed);
    const dropped: ExecResult = { ok: false, code: 'transport_failed', message: 'dropped' };
    await expect(withMachine(recorder(dropped).transport, 'klaw').exec('x', 1_000)).resolves.toBe(dropped);
  });

  it('gives the client connect_failed with the machine sentence, not an exit code', async () => {
    const { transport } = recorder({ ok: true, stdout: '', stderr: '', exitCode: 255 });
    const client = new HerdrClient(withMachine(transport, 'klaw', { host: 'Gimel', machine: 'klaw' }));
    await expect(client.ping()).rejects.toMatchObject({ code: 'connect_failed', message: "Gimel can't reach klaw right now." });
  });

  it('streams through the jump, passing the abort signal on', async () => {
    const { transport, calls } = recorder();
    const controller = new AbortController();
    const lines: string[] = [];
    for await (const line of withMachine(transport, 'nuku').streamLines('tail -f x', 1_000, controller.signal)) {
      lines.push(line);
    }
    expect(lines).toEqual(['line']);
    expect(calls).toEqual([
      { command: jumpStream('nuku', 'tail -f x'), timeoutMs: 1_000 + JUMP_CONNECT_TIMEOUT_MS, signal: controller.signal },
    ]);
  });
});

describe('jumpStream', () => {
  it('wraps the machine-side command so it stops when its stdin goes', () => {
    expect(jumpStream('nuku', 'tail -f x')).toContain(shellQuote(untilChannelCloses('tail -f x')));
    expect(jumpStream('nuku', 'tail -f x')).toMatch(/while sleep \d+ && echo; do :; done \| ssh /);
  });

  // The host's wrapper runs the jump with stdin from /dev/null; without the
  // newline loop the machine's watcher would see end of input at once and
  // stop the command before it printed anything.
  it('keeps the stream open, and ends it with the machine-side command', async () => {
    const host = fakeHost();
    try {
      const child = spawn('sh', ['-c', untilChannelCloses(jumpStream('nuku', "echo hi; sleep 1; echo there; exit 3", 1_000))], {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: host.env,
      });
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
      expect(out).toBe('hi\nthere\n');
      expect(code).toBe(3);
      child.stdin.end();
    } finally {
      host.cleanup();
    }
  }, 15_000);
});
