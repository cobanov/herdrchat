import type { ExecResult } from '../../../modules/herdr-ssh/src';
import { HerdrClient } from '../herdr/client';
import type { HerdrTransport } from '../herdr/transport';
import { JS_DEADLINE_GRACE_MS, POLL_TIMEOUT_MS, withJsDeadline } from '../herdr/timeouts';

/**
 * The bug these cover is not "a command was slow".
 *
 * Nothing in the stack used to carry a deadline, and both poll loops re-arm
 * inside a `finally` — so a command that never settled meant the `finally`
 * never ran, the loop stopped, and the screen froze holding stale data with no
 * error shown. Force-quitting was the only recovery.
 *
 * So the assertion that matters everywhere below is that the promise SETTLES.
 */

describe('withJsDeadline', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('settles a command that never would, rather than waiting forever', async () => {
    const settled = jest.fn();
    void withJsDeadline(new Promise<ExecResult>(() => {}), 1_000).then(settled);

    await jest.advanceTimersByTimeAsync(1_000 + JS_DEADLINE_GRACE_MS + 1);

    expect(settled).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, code: 'timeout' })
    );
  });

  it('waits past the native deadline before firing its own', async () => {
    const settled = jest.fn();
    void withJsDeadline(new Promise<ExecResult>(() => {}), 1_000).then(settled);

    // At the native deadline the native side may still answer. Pre-empting it
    // would report a timeout for a command that was about to succeed, and would
    // leave the native connection un-reset.
    await jest.advanceTimersByTimeAsync(1_000);
    expect(settled).not.toHaveBeenCalled();
  });

  it('passes a real answer straight through and cancels its timer', async () => {
    const ok: ExecResult = { ok: true, stdout: 'hi', stderr: '', exitCode: 0 };
    await expect(withJsDeadline(Promise.resolve(ok), 1_000)).resolves.toEqual(ok);
    // No pending timer means the process can exit; a leaked one would keep a
    // React Native app awake for the full grace period after every command.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('turns a rejection into a result, because callers never catch', async () => {
    await expect(
      withJsDeadline(Promise.reject(new Error('socket closed')), 1_000)
    ).resolves.toEqual({ ok: false, code: 'transport_failed', message: 'socket closed' });
  });
});

describe('HerdrClient under a timeout', () => {
  /** A host that accepts commands and never answers any of them. */
  class SilentTransport implements HerdrTransport {
    readonly budgets: number[] = [];
    async exec(_command: string, timeoutMs: number): Promise<ExecResult> {
      this.budgets.push(timeoutMs);
      return { ok: false, code: 'timeout', message: "The host didn't answer in time." };
    }
    async *streamLines(): AsyncIterable<string> {}
  }

  it('reports a timeout as an error the caller can show, not a hang', async () => {
    const client = new HerdrClient(new SilentTransport());
    await expect(client.snapshot()).rejects.toMatchObject({ code: 'timeout' });
  });

  it('asks for a poll-sized budget when polling', async () => {
    const transport = new SilentTransport();
    const client = new HerdrClient(transport);
    await client.snapshot().catch(() => undefined);
    expect(transport.budgets).toEqual([POLL_TIMEOUT_MS]);
  });

  it('gives a launch far longer than a poll', async () => {
    const transport = new SilentTransport();
    const client = new HerdrClient(transport);
    await client.createWorkspace('/tmp/x', null).catch(() => undefined);
    // Creating a workspace and waiting for an agent to become interactive is
    // legitimately slow; holding it to a poll's deadline would fail good work.
    expect(transport.budgets[0]).toBeGreaterThan(POLL_TIMEOUT_MS);
  });

  /**
   * `agent wait` is told how long to block host-side. Our own deadline has to
   * outlast that, or a perfectly normal "the agent didn't reach that state"
   * comes back as a transport timeout instead.
   */
  it('never cuts off a host-side wait it asked for', async () => {
    const transport = new SilentTransport();
    const client = new HerdrClient(transport);
    await client.waitAgentStatus('w1:p1', 'working', 30_000);
    expect(transport.budgets[0]).toBeGreaterThan(30_000);
  });
});
