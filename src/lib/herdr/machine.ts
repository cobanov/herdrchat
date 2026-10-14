import type { ExecResult, SshFailureCode } from '../../../modules/herdr-ssh/src';
import { shellQuote, untilChannelCloses, withPath } from './shell';
import {
  JUMP_CONNECT_TIMEOUT_MS,
  JUMP_DEADLINE_MARGIN_MS,
  JUMP_KEEPALIVE_MS,
  JUMP_KILL_GRACE_MS,
  JUMP_SERVER_ALIVE_MS,
} from './timeouts';
import type { HerdrTransport } from './transport';

/**
 * Reaching a machine saved on the host, through the host.
 *
 * herdr can save other computers that run herdr (`herdr machine add <target>`),
 * and its own clients federate them with `herdr --machine <label> …`. The app
 * cannot use that flag: it reads transcripts, uploads pictures and probes the
 * herdr socket with plain shell (`tail`, `cat`, `python3 -S -c …`), which
 * `--machine` does not carry. And it cannot reach the machine itself, because
 * a machine's `target` is an SSH destination only the host can resolve: an
 * alias in the host's `~/.ssh/config`, with keys OpenSSH owns there.
 *
 * So every command for a machine is the same command, run by the host's own
 * `ssh` on the machine. One transport wrapper, like `withSession`, and for the
 * same reason: everything reaches a host through `exec` or `streamLines`, so
 * wrapping the transport means no call site has to remember the machine.
 * Wrap the machine first and the session second —
 * `withSession(withMachine(hostTransport, target), session)` — so the
 * `HERDR_SESSION` export runs on the machine, where its herdr is.
 */

/** The `ssh` options of every jump, before the destination. */
function sshOptions(): string {
  return [
    'ssh',
    // Never prompt: there is nobody at the host's terminal to answer, and a
    // prompt would hang the command until its deadline.
    '-o BatchMode=yes',
    `-o ConnectTimeout=${Math.round(JUMP_CONNECT_TIMEOUT_MS / 1000)}`,
    `-o ServerAliveInterval=${Math.round(JUMP_SERVER_ALIVE_MS / 1000)}`,
    // One unanswered probe and the link is dead: noticed within two
    // intervals, not the default three plus one.
    '-o ServerAliveCountMax=1',
  ].join(' ');
}

/**
 * The `ssh` command that runs `command` on the machine `target`, as words for
 * the host's shell. `jumpCommand` and `jumpStream` hand these words to
 * `JUMP_SCRIPT`, which adds the connection sharing and the bound.
 *
 * `ssh` joins everything after the destination with spaces and hands it to the
 * machine's login shell, which parses it once more. So the command travels as
 * ONE single-quoted word, and the machine's shell gets back exactly the text the
 * client built — its own quoting, `$HOME`, newlines and all.
 *
 * No `-t`. A pty would make the machine's stdout a terminal: line endings would
 * become `\r\n` and the byte offsets the transcript reader counts would drift
 * from the file's, silently skipping messages.
 */
export function sshJump(target: string, command: string): string {
  return `${sshOptions()} -- ${shellQuote(target)} ${shellQuote(command)}`;
}

/**
 * The exit status of a jumped command that the host stopped at its bound.
 *
 * Not 124, `timeout(1)`'s: a command on the machine may bound itself with
 * `timeout` and exit 124, and that is the command's own answer, not the jump's.
 * And not `ssh`'s: an `ssh` stopped by a signal exits 255, which reads as "can't
 * reach". A command on the machine that itself exits 254 reads as a timeout;
 * nothing the app runs does.
 */
export const JUMP_TIMED_OUT_EXIT = 254;

/**
 * Where the host keeps the shared connections to its machines. Under the same
 * cache directory as the uploads, and only when it is short enough: a socket's
 * path is capped at 104 bytes on macOS (108 on Linux), `ssh` refuses to start at
 * all with a longer `ControlPath`, and while it creates the socket it adds a
 * 17-byte suffix to the 45 of `/ssh-%C`. A longer home directory jumps without
 * sharing, which only costs logins.
 */
const CONTROL_DIR = '$HOME/.cache/herdrchat';
const CONTROL_DIR_MAX = 40;

/**
 * The host-side wrapper around every jump, run by `sh` rather than the host's
 * login shell, which may be zsh or fish. Arguments: the bound in seconds (0 for
 * none), then the `ssh` command's words.
 *
 * Connection sharing: `ControlMaster=auto` with `ControlPersist=60`, so a
 * machine's polls reuse one login rather than each opening another: with the
 * event stream down, the poll alone was twenty logins a minute in the
 * machine's auth log. The first jump's `ssh` leaves a master in the
 * background (detached: not a child of anything here, so neither the bound nor
 * a stream's watcher stops it with the command), the rest attach to it, and it
 * goes after a minute unused. Every OpenSSH of the last decade has these
 * options (`%C` since 6.7), so they are not probed for.
 *
 * The bound: `ssh` runs in the background with a watchdog beside it. At the
 * bound the watchdog stops it (TERM, then KILL after `JUMP_KILL_GRACE_MS`) and
 * exits `JUMP_TIMED_OUT_EXIT`, which becomes the jump's status. The watchdog's
 * status, not `ssh`'s, says whether it fired, because a stopped `ssh` exits
 * 255 like one that could not connect. When `ssh` ends first, the watchdog is
 * stopped, and stops its own `sleep` so nothing is left on the host. A stream
 * is not bounded (0): it runs `ssh` in the foreground, on the stdin it was
 * given.
 */
const JUMP_SCRIPT = [
  'hj_s=$1; hj_ssh=$2; shift 2',
  `hj_d="${CONTROL_DIR}"`,
  `if [ \${#hj_d} -le ${CONTROL_DIR_MAX} ] && mkdir -p "$hj_d" 2>/dev/null; then`,
  '  set -- -o ControlMaster=auto -o "ControlPath=$hj_d/ssh-%C" -o ControlPersist=60 "$@"',
  'fi',
  '[ "$hj_s" -gt 0 ] || exec "$hj_ssh" "$@"',
  '"$hj_ssh" "$@" </dev/null &',
  'hj_p=$!',
  '(',
  `  trap 'kill "$hj_z" 2>/dev/null; exit 0' TERM`,
  '  sleep "$hj_s" & hj_z=$!; wait "$hj_z"',
  '  kill "$hj_p" 2>/dev/null || exit 0',
  `  trap 'kill "$hj_z" 2>/dev/null; exit ${JUMP_TIMED_OUT_EXIT}' TERM`,
  `  sleep ${Math.ceil(JUMP_KILL_GRACE_MS / 1000)} & hj_z=$!; wait "$hj_z"`,
  '  kill -9 "$hj_p" 2>/dev/null',
  `  exit ${JUMP_TIMED_OUT_EXIT}`,
  ') </dev/null >/dev/null 2>&1 &',
  'hj_w=$!',
  'wait "$hj_p"; hj_r=$?',
  'kill "$hj_w" 2>/dev/null',
  `wait "$hj_w"; [ $? -eq ${JUMP_TIMED_OUT_EXIT} ] && hj_r=${JUMP_TIMED_OUT_EXIT}`,
  'exit "$hj_r"',
].join('\n');

/** `JUMP_SCRIPT` with its arguments, as words for the host's shell. */
function wrapJump(seconds: number | string, target: string, command: string): string {
  return `sh -c ${shellQuote(JUMP_SCRIPT)} hj ${seconds} ${sshJump(target, command)}`;
}

/**
 * The host-side bound of a command whose own deadline is `timeoutMs`, and the
 * native deadline it is sent with. The bound is the command's own time plus the
 * jump's connect time; the native deadline stays `JUMP_DEADLINE_MARGIN_MS`
 * above it, so the host always stops its `ssh` first.
 */
export function jumpDeadlines(timeoutMs: number): { boundSeconds: number; nativeMs: number } {
  const boundSeconds = Math.max(1, Math.ceil((timeoutMs + JUMP_CONNECT_TIMEOUT_MS) / 1000));
  return { boundSeconds, nativeMs: boundSeconds * 1000 + JUMP_DEADLINE_MARGIN_MS };
}

/**
 * What `withMachine` runs on the host for one command: the jump, bounded, with
 * a full PATH.
 *
 * Bounded on the host because nothing else bounds the host's `ssh` in time: a
 * machine that is up but whose herdr wedged answers every keepalive, and only
 * the native deadline was left, which resets the phone's connection to the
 * host (see `JUMP_DEADLINE_MARGIN_MS`).
 */
export function jumpCommand(target: string, command: string, timeoutMs: number): string {
  return withPath(wrapJump(jumpDeadlines(timeoutMs).boundSeconds, target, command));
}

/**
 * What `withMachine` runs on the host for a stream.
 *
 * A stream is stopped by closing its channel, and closing a channel does not
 * stop the command behind it (see `untilChannelCloses`). On the host,
 * `SshHerdrTransport` already wraps whatever it streams, so closing the app's
 * channel stops the host's `ssh`. That drops the connection to the machine,
 * and the machine's sshd closes its command's stdin, but sends it no signal
 * (there is no pty to hang up): a quiet `tail -f` on the machine would never
 * find out, exactly as it never did on a host. So the command on the machine is
 * wrapped too, watching its own stdin.
 *
 * Which needs the machine's stdin to stay open while the stream lives, and the
 * host's wrapper runs its command with stdin from /dev/null, which `ssh` would
 * forward as an immediate end of input. The newline loop feeds `ssh` instead:
 * the machine's watcher swallows the newlines, its end of input arrives when
 * the host's `ssh` goes, and when the machine's command ends by itself, the
 * next newline fails and the loop ends too, so the stream ends within
 * `JUMP_KEEPALIVE_MS` rather than never. Not `ssh <&3`, the host wrapper's
 * own copy of the channel's stdin: `ssh` makes its stdin non-blocking, which
 * on a shared descriptor would end the host's watcher at once.
 *
 * The chain, then: the app closes the channel → the host's watcher stops `ssh`
 * and the loop → the machine's command loses its stdin → the machine's watcher
 * stops it.
 */
export function jumpStream(target: string, command: string, keepaliveMs: number = JUMP_KEEPALIVE_MS): string {
  const seconds = Math.max(1, Math.round(keepaliveMs / 1000));
  return withPath(`while sleep ${seconds} && echo; do :; done | ${wrapJump(0, target, untilChannelCloses(command))}`);
}

/** Read back one `shellQuote`d word, or null when `word` is not exactly one. */
function unquoteWord(word: string): string | null {
  if (word.length < 2 || !word.startsWith("'") || !word.endsWith("'")) return null;
  const text = word.slice(1, -1).replaceAll(`'\\''`, `'`);
  return shellQuote(text) === word ? text : null;
}

/**
 * The machine-side command inside a `jumpCommand(target, …)`, whatever its
 * bound, or null when `command` is not one. For the Demo, which answers a
 * machine's commands the way a host would: by the same builder, so a change to
 * the jump cannot silently leave the Demo answering a shape the app no longer
 * sends.
 */
export function unwrapJump(target: string, command: string): string | null {
  const marker = '\u0000';
  const [before = '', after = ''] = withPath(wrapJump(marker, target, '')).split(marker);
  const prefix = before;
  const middle = after.slice(0, -shellQuote('').length);
  if (!command.startsWith(prefix)) return null;
  const seconds = /^\d+/.exec(command.slice(prefix.length))?.[0];
  if (seconds === undefined) return null;
  const rest = command.slice(prefix.length + seconds.length);
  if (!rest.startsWith(middle)) return null;
  const inner = unquoteWord(rest.slice(middle.length));
  return inner !== null && withPath(wrapJump(seconds, target, inner)) === command ? inner : null;
}

/** The machine-side command inside a `jumpStream(target, …)`, or null. See `unwrapJump`. */
export function unwrapJumpStream(target: string, command: string, keepaliveMs: number = JUMP_KEEPALIVE_MS): string | null {
  const marker = '\u0000';
  const [streamBefore = '', streamAfter = ''] = jumpStream(target, marker, keepaliveMs).split(shellQuote(untilChannelCloses(marker)));
  if (!command.startsWith(streamBefore) || !command.endsWith(streamAfter)) return null;
  const word = unquoteWord(command.slice(streamBefore.length, command.length - streamAfter.length));
  if (word === null) return null;
  const [before = '', after = ''] = untilChannelCloses(marker).split(marker);
  if (!word.startsWith(before) || !word.endsWith(after)) return null;
  const inner = word.slice(before.length, word.length - after.length);
  return jumpStream(target, inner, keepaliveMs) === command ? inner : null;
}

/** `ssh`'s own failure status, as opposed to the machine's command's. */
export const SSH_FAILED_EXIT = 255;

/** Who is reaching whom, for the sentence a person reads when it fails. */
export interface MachineNames {
  /** The host's name as the person saved it ("Gimel"). */
  host: string;
  /** The machine's label in herdr ("klaw"). */
  machine: string;
}

/** The sentence for a machine the host cannot reach. */
export function machineUnreachableMessage(names: MachineNames): string {
  return `${names.host} can't reach ${names.machine} right now.`;
}

/**
 * The host's ssh reached the machine and could not log in without a prompt.
 * Not `auth_failed`: that one is about the phone's own login to the host, and
 * the way out it offers (this host's credentials) is the wrong computer.
 */
export const MACHINE_AUTH_FAILED = 'machine_auth_failed' satisfies SshFailureCode;
/** The host's ssh does not trust the machine's host key: unknown, or changed. */
export const MACHINE_HOST_KEY = 'machine_host_key' satisfies SshFailureCode;
/** The host stopped its ssh to the machine at the jump's bound (`JUMP_TIMED_OUT_EXIT`). */
export const MACHINE_TIMEOUT = 'machine_timeout' satisfies SshFailureCode;

/** The sentence for a machine that took longer than the command's deadline. */
export function machineTimeoutMessage(names: MachineNames): string {
  return `${names.machine} did not answer in time.`;
}

/**
 * What an ssh exit 255 says, from the first line of its stderr that names a
 * cause.
 *
 * Only a real connect or timeout failure is "can't reach it right now": a
 * refused login or an unknown host key fails the same way on every retry, and
 * "right now" left a person pulling to refresh forever. The jump runs inside
 * the host's sshd session with `BatchMode=yes`, so it cannot use an agent that
 * wants an approval on the host's screen, nor one only the desktop login
 * exports, and it cannot accept a new host key; an interactive `ssh klaw` on
 * the host can, which is why that check passes while the jump fails.
 */
export function jumpFailure(stderr: string, target: string, names: MachineNames): { code: SshFailureCode; message: string } {
  const { host, machine } = names;
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key for .* has changed/i.test(stderr)) {
    return {
      code: MACHINE_HOST_KEY,
      message: `${machine}'s host key has changed since ${host} last connected. If you expect that, update it in ${host}'s ~/.ssh/known_hosts.`,
    };
  }
  if (/Host key verification failed|No .*host key is known/i.test(stderr)) {
    return {
      code: MACHINE_HOST_KEY,
      message: `${host} doesn't trust ${machine}'s host key yet. On ${host}, run ssh ${target} once and accept it.`,
    };
  }
  if (/Permission denied|Too many authentication failures|agent refused|sign_and_send_pubkey/i.test(stderr)) {
    return {
      code: MACHINE_AUTH_FAILED,
      message: `${host}'s ssh can't log in to ${machine} without a prompt. Give ${machine} a key file in ${host}'s ~/.ssh/config (IdentityFile), not an agent that asks for approval.`,
    };
  }
  if (/Could not resolve hostname/i.test(stderr)) {
    return {
      code: 'connect_failed',
      message: `${host} can't find ${machine}: nothing in its ssh config or DNS answers to ${target}.`,
    };
  }
  return { code: 'connect_failed', message: machineUnreachableMessage(names) };
}

/**
 * Bind a host's transport to one of its machines.
 *
 * `ssh` returns the machine's command's exit status, and 255 for its own
 * failure: the host could not reach the machine, lost it, or could not log in
 * to it (`jumpFailure` tells which). That is turned into a failed result here rather than in `client.ts`, because the
 * transcript store, the socket bridge and the picture upload reach the machine
 * through this transport without passing through the client, and each would
 * otherwise read 255 as a command that failed on the host. A command on the
 * machine that itself exits 255 reads the same way; nothing the app runs does.
 *
 * A stream's exit status is not reported to its reader, so a stream to an
 * unreachable machine simply ends, as a stream to a host that drops does, and
 * the tail watchdog treats it the same.
 *
 * Each command is bounded on the host (`jumpCommand`): its own deadline plus
 * the jump's connect timeout, after which the host stops its `ssh` and the
 * command ends `JUMP_TIMED_OUT_EXIT`, read here as `machine_timeout`. The
 * native deadline is set `JUMP_DEADLINE_MARGIN_MS` above that, so it fires only
 * if the host itself stops answering. A stream is not bounded in time, which
 * would end a healthy one: its native deadline covers only opening the host's
 * channel, which a hung machine cannot delay, its connect is bounded by
 * `ConnectTimeout`, and a link that dies under it by `ServerAliveCountMax=1`.
 *
 * Channels: every jump is one more channel on the host's one connection, and
 * the host's sshd allows ten at once by default (MaxSessions). Each machine
 * holds its event stream open, and an open thread its live tail, and on iOS a
 * refused channel resets the connection, so a host with four or more machines
 * and a thread open may come near it. Not seen on a device; there is no queue
 * in the transport to cap machine commands with yet, and this is where one
 * would go. On the machine's side the shared connection (`JUMP_SCRIPT`) carries
 * all of a machine's sessions, under the machine's own MaxSessions.
 *
 * Out of scope for now: push notifications for a machine's chats (the
 * watcher on the host does not see the machine's sessions), and the machine's
 * own `~/.herdrchat/theme.json` (the host's theme applies to its machines).
 */
export function withMachine(
  transport: HerdrTransport,
  target: string,
  names: MachineNames = { host: 'The host', machine: target }
): HerdrTransport {
  return {
    exec: async (command, timeoutMs): Promise<ExecResult> => {
      const result = await transport.exec(jumpCommand(target, command, timeoutMs), jumpDeadlines(timeoutMs).nativeMs);
      if (result.ok && result.exitCode === JUMP_TIMED_OUT_EXIT) {
        return { ok: false, code: MACHINE_TIMEOUT, message: machineTimeoutMessage(names) };
      }
      if (result.ok && result.exitCode === SSH_FAILED_EXIT) {
        return { ok: false, ...jumpFailure(result.stderr, target, names) };
      }
      return result;
    },
    streamLines: (command, startTimeoutMs, signal) =>
      transport.streamLines(jumpStream(target, command), startTimeoutMs + JUMP_CONNECT_TIMEOUT_MS, signal),
  };
}
