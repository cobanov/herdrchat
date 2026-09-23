import { spawn } from 'node:child_process';

import { HerdrClient } from '../herdr/client';
import { subscriptionsFor } from '../herdr/events';
import { HerdrSocket } from '../herdr/socket';
import type { HerdrTransport } from '../herdr/transport';

/**
 * The socket layer against a REAL herdr, on this machine, through `sh -c`
 * standing in for SSH exec. Runs only with `HERDR_LIVE=1` so CI, which has no
 * herdr, is not asked to pretend.
 *
 *   HERDR_LIVE=1 npx jest socket.live
 *
 * Needs a running server and at least one agent. With `HERDR_LIVE_PANE` set
 * to a pane that is safe to prompt (the `apptest` workspace), it also sends a
 * prompt and watches the event stream answer it.
 */
const live = process.env.HERDR_LIVE === '1' ? describe : describe.skip;

/**
 * Which herdr to test. Defaults to `herdr` on PATH and its default session.
 *
 * The development Mac runs the jerryfane/herdr fork, and this suite passing
 * only there is how the app came to depend on fork-only behaviour (#75, #76,
 * #85). Point it at an upstream stable binary and a throwaway session too:
 *
 *   HERDR_SESSION=hc-upstream-test ~/.local/bin/herdr-stable-0.9.1 server &
 *   HERDR_LIVE=1 HERDR_LIVE_BIN=~/.local/bin/herdr-stable-0.9.1 \
 *     HERDR_LIVE_SESSION=hc-upstream-test npx jest socket.live
 */
const BIN = process.env.HERDR_LIVE_BIN ?? 'herdr';
const SESSION = process.env.HERDR_LIVE_SESSION;

/** `sh -c`, with the HERDR_* variables a herdr pane would leak stripped, as SSH would. */
const localTransport: HerdrTransport = {
  exec: (command, timeoutMs) =>
    new Promise((resolve) => {
      const child = spawn('sh', ['-c', command], { env: cleanEnv() });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
      const timer = setTimeout(() => {
        child.kill();
        resolve({ ok: false, code: 'timeout', message: `timed out after ${timeoutMs}ms` } as never);
      }, timeoutMs);
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        resolve({ ok: true, exitCode: exitCode ?? 1, stdout, stderr } as never);
      });
    }),
  streamLines: async function* (command, _startTimeoutMs, signal) {
    const child = spawn('sh', ['-c', command], { env: cleanEnv() });
    // Like the native reader: an abort ends the remote command even while the
    // host is silent, so a test that gives up does not leave a bridge running.
    signal?.addEventListener('abort', () => child.kill(), { once: true });
    const queue: string[] = [];
    let done = false;
    let wake: (() => void) | null = null;
    let buffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      queue.push(...lines);
      wake?.();
    });
    child.on('close', () => {
      done = true;
      wake?.();
    });
    try {
      while (!done || queue.length > 0) {
        const line = queue.shift();
        if (line !== undefined) {
          yield line;
          continue;
        }
        await new Promise<void>((resolve) => (wake = resolve));
        wake = null;
      }
    } finally {
      child.kill();
    }
  },
};

/**
 * Every `HERDR_*` a herdr pane would leak is stripped, as SSH would. An
 * inherited `HERDR_SOCKET_PATH` in particular wins over `HERDR_SESSION` and
 * made a session look ignored. The chosen session is then set on its own.
 */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('HERDR_')) delete env[key];
  }
  if (SESSION !== undefined) env.HERDR_SESSION = SESSION;
  return env;
}

live('herdr socket, live', () => {
  const socket = new HerdrSocket(localTransport, BIN);
  const client = new HerdrClient(localTransport, BIN);

  it('serves the client a snapshot and an agent list without the CLI', async () => {
    const snapshot = await client.snapshot();
    expect(snapshot.version).toMatch(/^\d+\.\d+/);
    const agents = await client.agents();
    expect(Array.isArray(agents)).toBe(true);
  });

  it('finds a bridge and the socket path', async () => {
    const route = await socket.detect();
    expect(route).not.toBeNull();
    expect(route?.socketPath).toMatch(/herdr\.sock$/);
  });

  it('pings', async () => {
    const result = (await socket.call('ping', {}, 5000)) as { type: string; version: string };
    expect(result.type).toBe('pong');
    expect(result.version).toMatch(/^\d+\.\d+/);
  });

  it('lists agents with the fields the app keys on', async () => {
    const result = (await socket.call('agent.list', {}, 5000)) as { agents: Record<string, unknown>[] };
    expect(Array.isArray(result.agents)).toBe(true);
    for (const agent of result.agents) {
      expect(typeof agent['pane_id']).toBe('string');
      expect(typeof agent['agent_status']).toBe('string');
    }
  });

  // #75: the app's whole subscription must be accepted. herdr refuses the
  // entire request over one event type it does not know.
  it("accepts the app's event subscription and delivers a host-wide event", async () => {
    const created = (await socket.call(
      'workspace.create',
      { cwd: process.env.HOME ?? '/', label: 'herdrchat-live-sub' },
      5000
    )) as { workspace: { workspace_id: string }; root_pane: { pane_id: string } };
    const workspaceId = created.workspace.workspace_id;
    try {
      const seen: string[] = [];
      // Upstream names lifecycle events on the wire `workspace_renamed`, while
      // the subscription type is `workspace.renamed`. The app only kicks a
      // refresh on any event, so either spelling is fine; the test takes both.
      const renamed = (name: string) => /^workspace[._]renamed$/.test(name);
      const controller = new AbortController();
      const stream = (async () => {
        for await (const event of socket.subscribe(
          subscriptionsFor([created.root_pane.pane_id]),
          5000,
          controller.signal
        )) {
          if (event.kind !== 'event') continue;
          seen.push(event.event);
          if (renamed(event.event)) break;
        }
      })();
      try {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await socket.call('workspace.rename', { workspace_id: workspaceId, label: 'herdrchat-live-sub-2' }, 5000);
        await Promise.race([
          stream,
          new Promise((_, reject) => setTimeout(() => reject(new Error('no event within 10 s')), 10000)),
        ]);
      } finally {
        controller.abort();
      }
      expect(seen.some(renamed)).toBe(true);
    } finally {
      await socket.call('workspace.close', { workspace_id: workspaceId }, 5000);
    }
  }, 30000);

  it('names a missing method as invalid_request rather than failing opaquely', async () => {
    await expect(socket.call('no.such.method', {}, 5000)).rejects.toMatchObject({ code: 'invalid_request' });
  });

  // The full round-trip: a workspace of its own, a Claude in it, one prompt,
  // the event stream answering it, and the workspace closed again. Opt-in with
  // HERDR_LIVE_PROMPT=1 because it spends a Claude turn. HERDR_LIVE_CWD picks
  // the folder; use one Claude already trusts, or the trust prompt blocks it.
  (process.env.HERDR_LIVE_PROMPT === '1' ? it : it.skip)(
    'starts an agent, prompts it, and sees the turn complete on the event stream',
    async () => {
      const created = (await socket.call(
        'workspace.create',
        { cwd: process.env.HERDR_LIVE_CWD ?? `${process.env.HOME ?? ''}/Developer/apptest`, label: 'herdrchat-live-test' },
        5000
      )) as { workspace: { workspace_id: string }; root_pane: { pane_id: string } };
      const workspaceId = created.workspace.workspace_id;
      const pane = created.root_pane.pane_id;
      try {
        const seen: string[] = [];
        const readiness: { resolve: (() => void) | null } = { resolve: null };
        const ready = new Promise<void>((resolve) => (readiness.resolve = resolve));
        const stream = (async () => {
          // Exactly what the app subscribes to, so a type the host refuses fails here.
          for await (const event of socket.subscribe(subscriptionsFor([pane]), 5000)) {
            if (event.kind !== 'event') continue;
            const status = String(event.data['agent_status']);
            seen.push(`${event.event}:${status}`);
            // First rest: the agent is up. Second rest: the turn is over.
            if (event.event === 'pane.agent_status_changed' && (status === 'idle' || status === 'done')) {
              if (readiness.resolve !== null) {
                readiness.resolve();
                readiness.resolve = null;
              } else {
                break;
              }
            }
          }
        })();

        await socket.call(
          'agent.start',
          { name: 'herdrchat-live-test', kind: 'claude', pane_id: pane, timeout_ms: 60000 },
          10000
        );
        await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('agent never became idle')), 45000))]);
        seen.length = 0;

        // Through the client, so what the app will call is what is verified.
        await expect(
          client.sendPrompt(pane, 'Reply with exactly the word OK and nothing else.')
        ).resolves.toBe('delivered');

        await Promise.race([stream, new Promise((resolve) => setTimeout(resolve, 15000))]);
        expect(seen[0]).toBe('pane.agent_status_changed:working');
        expect(seen.slice(1).some((s) => /agent_status_changed:(idle|done)$/.test(s))).toBe(true);
      } finally {
        await socket.call('workspace.close', { workspace_id: workspaceId }, 5000);
      }
    },
    150000
  );
});
