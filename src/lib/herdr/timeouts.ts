import type { ExecResult } from '../../../modules/herdr-ssh/src';

/**
 * How long each kind of remote command may take before we give up on it.
 *
 * Every command this app runs goes over SSH to a machine that may have gone to
 * sleep, changed network, or wedged. Before these existed there was no deadline
 * anywhere in the stack, and the failure mode was not "a slow refresh": both
 * poll loops re-arm inside a `finally`, so a command that never settled stopped
 * the loop permanently and the screen froze holding stale data with no error at
 * all. Only force-quitting recovered it.
 *
 * The numbers are chosen so that exceeding one is genuinely evidence of a
 * problem rather than of a slow link. A poll that takes fifteen seconds has
 * already missed seven of its own ticks; there is nothing to wait for.
 */

/** A status/list poll. Short: it runs again in two seconds anyway. */
export const POLL_TIMEOUT_MS = 15_000;

/** Reading a pane's visible screen — bounded output, same urgency as a poll. */
export const SCREEN_TIMEOUT_MS = 15_000;

/** Sending a message or a keystroke. The user is watching this one. */
export const SEND_TIMEOUT_MS = 20_000;

/**
 * Reading transcript history. Deliberately looser: `recent()` may pull three
 * megabytes over a phone's uplink, and a slow read here is inconvenient rather
 * than broken.
 */
export const TRANSCRIPT_TIMEOUT_MS = 30_000;

/**
 * Creating a workspace, or starting an agent and waiting for it to become
 * interactive. herdr itself may legitimately block for most of a minute.
 */
export const LAUNCH_TIMEOUT_MS = 60_000;

/**
 * Installing herdr, or one of its integrations, on the host. A `curl | sh` over
 * someone's home internet is allowed to be slow.
 */
export const INSTALL_TIMEOUT_MS = 180_000;

/**
 * Getting a `tail -f` started. The stream itself is unbounded on purpose — a
 * live tail is meant to outlive any deadline — so only the handshake is
 * measured. A stream that dies quietly afterwards is the tail watchdog's job.
 */
export const STREAM_START_TIMEOUT_MS = 20_000;

/**
 * The grace period between the native deadline and the JS one.
 *
 * Firing first would report a timeout while the native side is still capable of
 * returning a real answer, and would leave its connection un-reset.
 */
export const JS_DEADLINE_GRACE_MS = 5_000;

/**
 * A second deadline, in JS, slightly later than the native one.
 *
 * Belt as well as braces. The native timer is the one that can actually tear
 * the channel down, so it does the real work. This exists because the whole
 * point of the change is that NO path can hang a screen, and "the native module
 * always resolves" is exactly the assumption that turned out to be wrong.
 *
 * Never rejects. A transport failure is a result the caller is expected to
 * handle, not an exception — the same contract the native module already keeps.
 */
export function withJsDeadline(
  work: Promise<ExecResult>,
  timeoutMs: number
): Promise<ExecResult> {
  if (timeoutMs <= 0) return work;
  return new Promise<ExecResult>((resolve) => {
    const timer = setTimeout(() => {
      resolve({
        ok: false,
        code: 'timeout',
        message: "The host didn't answer in time. Check that it's awake and on the tailnet.",
      });
    }, timeoutMs + JS_DEADLINE_GRACE_MS);

    void work.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (thrown: unknown) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          code: 'transport_failed',
          message: thrown instanceof Error ? thrown.message : String(thrown),
        });
      }
    );
  });
}
