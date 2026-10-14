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
 * The deadline for the scan's file phase (every `find` under the person's,
 * the plugins' and the projects' folders, and the `head`/`sed` of what they
 * found), in whole seconds, one budget for the phase. Each `find` is stopped
 * by the host the same way as the greps; no file's `head`/`sed` starts once
 * the deadline has passed, though the one under way then runs to its end (a
 * read of `EXCERPT_BYTES`). `find -L` follows a symlink into any tree. It starts
 * after the greps, so the two together stay strictly inside
 * `SLASH_SCAN_TIMEOUT_MS`, with room for the connection's own round trip.
 */
export const SLASH_SCAN_FILES_TIMEOUT_S = 5;

/**
 * How long a grep over a binary that failed or hit its deadline is not tried
 * again for that same binary (path, size and mtime). The host-wide scan still
 * runs every `SLASH_SCAN_INTERVAL_MS` for the files; a new Claude Code is a
 * new binary and is read at once.
 */
export const SLASH_GREP_RETRY_MS = 21_600_000;

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
 * Reading a workflow run's file. Several hundred kilobytes when it has
 * changed, a line when it has not; a transcript read's budget either way.
 */
export const SUBAGENT_READ_TIMEOUT_MS = TRANSCRIPT_TIMEOUT_MS;

/**
 * How often an open workflow run is read again while it runs. Its agents take
 * minutes; a few seconds is live enough, and an unchanged file costs one line.
 */
export const WORKFLOW_POLL_MS = 3_000;

/**
 * How long a workflow the transcript still calls running may show no sign of
 * life (being first looked for, a change to its journal or run file) before
 * its card stops following it. A run whose session died writes neither a run
 * file nor a notification, and without a cap its chat read two files every
 * three seconds for as long as it stayed open. Generous: one agent of a phase
 * can work for a long while without the journal moving. A reload follows it
 * again.
 */
export const WORKFLOW_STALE_MS = 30 * 60_000;

/**
 * How often a subagent card asks which agent its call started, until the
 * agent has written its meta. The status poll's pace: the meta lands within a
 * second or two of the call.
 */
export const SUBAGENT_RESOLVE_RETRY_MS = 2_000;

/**
 * How often an open subagent screen looks in its parent transcript for its
 * agent's end, while it runs. A grep over the transcript on the host; only
 * the few lines naming the agent come back, and one line when none changed.
 */
export const SUBAGENT_END_POLL_MS = 3_000;

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
 * machine whether it is still there, with `ServerAliveCountMax=1`, so a machine
 * that went to sleep or off the network mid-command is given up within two of
 * these (one unanswered probe) rather than when TCP gives up, or, at the
 * default count of three, 45 seconds later.
 */
export const JUMP_SERVER_ALIVE_MS = 5_000;

/**
 * How far the native deadline of a jumped command stays above the host-side
 * bound on the host's `ssh` (see `jumpCommand`).
 *
 * The bound has to fire first. When the native deadline fires instead, it
 * drops the phone's whole connection to the host (`resetClient()` on iOS,
 * `abandon()` on Android), the host's own event stream and every open live tail
 * with it, so one machine that hangs took its host down about once a minute.
 * With the bound first, the host stops its `ssh` to the machine, the command
 * ends with the bound's status, and the host's connection never notices.
 */
export const JUMP_DEADLINE_MARGIN_MS = 5_000;

/**
 * How long the host-side bound waits, after asking the host's `ssh` to stop
 * (TERM), before it kills it outright. Inside `JUMP_DEADLINE_MARGIN_MS`, so even
 * an `ssh` that ignores the first signal is gone before the native deadline.
 */
export const JUMP_KILL_GRACE_MS = 2_000;

/**
 * How often a jumped stream's stdin hears a newline. The newline is what
 * keeps the machine's side of a stream alive while the host's channel is, and
 * what notices, within this long, that the machine's side has ended (see
 * `jumpStream`).
 */
export const JUMP_KEEPALIVE_MS = 5_000;

/**
 * Opening a terminal on a pane (`src/lib/terminal/command.ts`): the PTY
 * channel's handshake, plus the wait for the launch marker the native side
 * cuts the login shell's noise at. Only the start is bounded; the terminal
 * itself lives as long as the screen. A machine's terminal adds
 * `JUMP_CONNECT_TIMEOUT_MS` (see `terminalStartTimeout`).
 */
export const TERMINAL_START_TIMEOUT_MS = 20_000;

/**
 * How long the terminal's size in cells must hold still before the host's
 * pane is resized to it. The keyboard sliding in or out changes the size on
 * every frame of its animation, and each resize redraws the pane on the
 * desktop too; this sends the one it settles on. The view's own layout is not
 * held back, only what goes to the host.
 */
export const TERMINAL_RESIZE_DEBOUNCE_MS = 250;

/**
 * How often the chat list asks herdr which program a shell pane is running
 * ("vim", "htop"), counted in the list's own polls. One SSH exec for all the
 * shell panes (`HerdrSocket.callEach`), but a socket request per pane inside
 * it, so not every poll: a pane seen for the first time is asked at once, and
 * the rest on every this-many'th poll.
 */
export const PROCESS_NAME_SWEEP_POLLS = 5;
