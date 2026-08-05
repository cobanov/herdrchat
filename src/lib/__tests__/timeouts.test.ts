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

/**
 * Interrupt exists because the app could start work and not stop it — new chats
 * default to `bypassPermissions`, so an agent started from a phone runs tools
 * without asking.
 *
 * The key SPELLING is the part that cannot be checked from here: our one proven
 * name is the capitalised `Enter` quick replies have always sent, while the
 * Raycast extension sends lowercase `esc` against the same CLI. So interrupt
 * tries both rather than betting on one.
 */
describe('HerdrClient.interrupt', () => {
  class KeyTransport implements HerdrTransport {
    readonly sent: string[] = [];
    constructor(private readonly accept: (command: string) => boolean) {}
    async exec(command: string): Promise<ExecResult> {
      this.sent.push(command);
      return this.accept(command)
        ? { ok: true, stdout: '', stderr: '', exitCode: 0 }
        : { ok: true, stdout: '', stderr: 'unknown key', exitCode: 1 };
    }
    async *streamLines(): AsyncIterable<string> {}
  }

  it('stops at the first spelling the host accepts', async () => {
    const transport = new KeyTransport(() => true);
    await new HerdrClient(transport).interrupt('w1:p1');
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toContain('Escape');
  });

  it('falls back rather than leaving the button doing nothing', async () => {
    const transport = new KeyTransport((command) => command.includes("'esc'"));
    await new HerdrClient(transport).interrupt('w1:p1');
    expect(transport.sent).toHaveLength(2);
    expect(transport.sent[1]).toContain('esc');
  });

  it('surfaces a failure when the host accepts neither', async () => {
    const transport = new KeyTransport(() => false);
    await expect(new HerdrClient(transport).interrupt('w1:p1')).rejects.toThrow();
  });

  it('sends Ctrl-C only for the hard stop', async () => {
    const transport = new KeyTransport(() => true);
    await new HerdrClient(transport).interruptHard('w1:p1');
    expect(transport.sent[0]).toContain('ctrl+c');
  });
});

/**
 * Exit 127 has three unrelated causes and three unrelated fixes: install it,
 * tell us where it already is, or make it executable. We used to print all
 * three and let the reader work out which one they were in.
 */
describe('HerdrClient diagnosing a missing binary', () => {
  class ProbeTransport implements HerdrTransport {
    constructor(private readonly probeOutput: string) {}
    async exec(command: string): Promise<ExecResult> {
      // The probe is the only command that looks for the binary itself.
      if (command.includes('command -v')) {
        return { ok: true, stdout: this.probeOutput, stderr: '', exitCode: 0 };
      }
      return { ok: true, stdout: '', stderr: 'herdr: not found', exitCode: 127 };
    }
    async *streamLines(): AsyncIterable<string> {}
  }

  const failureFrom = async (probeOutput: string) => {
    const client = new HerdrClient(new ProbeTransport(probeOutput));
    return client.snapshot().then(
      () => null,
      (error: unknown) => error as { code: string; message: string }
    );
  };

  it('says install it when it is genuinely nowhere', async () => {
    const failure = await failureFrom('NONE\n');
    expect(failure?.code).toBe('herdr_not_found');
    expect(failure?.message).toContain("isn't installed");
  });

  it('names the path and the fix when it is installed but off PATH', async () => {
    const failure = await failureFrom('EXEC /opt/herdr/bin/herdr\n');
    expect(failure?.code).toBe('herdr_not_on_path');
    // The valuable case: the user does not have to install anything, only tell
    // us where it is — and the message hands them the exact path to paste.
    expect(failure?.message).toContain('/opt/herdr/bin/herdr');
    expect(failure?.message).toContain('Advanced settings');
  });

  it('says chmod when it is there but not executable', async () => {
    const failure = await failureFrom('NOEXEC /usr/local/bin/herdr\n');
    expect(failure?.code).toBe('herdr_not_executable');
    expect(failure?.message).toContain('chmod +x /usr/local/bin/herdr');
  });

  it('falls back to the old message when the probe itself says nothing useful', async () => {
    const failure = await failureFrom('what?\n');
    expect(failure?.code).toBe('herdr_not_found');
  });
});
