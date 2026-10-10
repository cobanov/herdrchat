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
 * Reading the slash-command catalogue off a host (`src/lib/slashCommands`):
 * one bounded `find` per fixed directory and, once per Claude Code version, a
 * `grep` over the installed binary, which takes a couple of seconds on a 230 MB
 * bundle. A side task like the theme check, so a slow one only means the
 * palette keeps what it had; but it holds the channel while it runs, so it is
 * not allowed a transcript read's patience.
 */
export const SLASH_SCAN_TIMEOUT_MS = 20_000;

/**
 * The deadline for the two `grep`s over the binary inside the scan (they run
 * side by side), in whole seconds, enforced by the host itself (`hs_bounded`
 * in `discover.ts`: `timeout(1)`, Perl's `alarm` on a Mac, else a watchdog),
 * since a channel the app gave up on does not stop the command behind it.
 * Well inside `SLASH_SCAN_TIMEOUT_MS`: reaching the native deadline resets
 * the whole SSH client, every live tail with it. Measured on Gimel with Claude
 * Code 2.1.296 (230 MB, BSD grep): about 5 s.
 */
export const SLASH_SCAN_GREP_TIMEOUT_S = 12;

/**
 * How often the chat list's poll reads the catalogue again. Commands and
 * skills change when someone installs one, which is rare; ten minutes keeps a
 * new one appearing the same session without making the scan a regular cost.
 * Pull-to-refresh asks sooner.
 */
export const SLASH_SCAN_INTERVAL_MS = 600_000;

/**
 * How long after a thread's first window has loaded a scan for that thread's
 * folder may start. The open is the moment the person is waiting on the
 * transcript; the scan goes after it, never in front of it.
 */
export const SLASH_SCAN_AFTER_OPEN_DELAY_MS = 1_500;

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

/**
 * Reaching a machine saved on the host (`herdr machine add`), through the
 * host's own `ssh` (see `machine.ts`).
 *
 * The jump's connect deadline. It is passed to `ssh` as `ConnectTimeout` and
 * added to every jumped command's own deadline, so the time the host spends
 * reaching the machine is never taken out of the command's budget: a poll that
 * may take fifteen seconds on the host may take fifteen on the machine, plus
 * this.
 */
export const JUMP_CONNECT_TIMEOUT_MS = 10_000;

/**
 * `ServerAliveInterval` on the jump: how often the host's `ssh` asks the
 * machine whether it is still there. Without it a machine that went to sleep
 * mid-command would hold the host's `ssh` open until TCP gave up, which is
 * far longer than any deadline above.
 */
export const JUMP_SERVER_ALIVE_MS = 15_000;

/**
 * How often a jumped stream's stdin hears a newline. The newline is what
 * keeps the machine's side of a stream alive while the host's channel is, and
 * what notices, within this long, that the machine's side has ended (see
 * `jumpStream`).
 */
export const JUMP_KEEPALIVE_MS = 5_000;
