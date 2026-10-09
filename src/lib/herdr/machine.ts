import type { ExecResult } from '../../../modules/herdr-ssh/src';
import { shellQuote, untilChannelCloses, withPath } from './shell';
import { JUMP_CONNECT_TIMEOUT_MS, JUMP_KEEPALIVE_MS, JUMP_SERVER_ALIVE_MS } from './timeouts';
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
  ].join(' ');
}

/**
 * The host-side command that runs `command` on the machine `target`.
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

/** What `withMachine` runs on the host for one command: the jump, with a full PATH. */
export function jumpCommand(target: string, command: string): string {
  return withPath(sshJump(target, command));
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
  return withPath(`while sleep ${seconds} && echo; do :; done | ${sshJump(target, untilChannelCloses(command))}`);
}

/** Read back one `shellQuote`d word, or null when `word` is not exactly one. */
function unquoteWord(word: string): string | null {
  if (word.length < 2 || !word.startsWith("'") || !word.endsWith("'")) return null;
  const text = word.slice(1, -1).replaceAll(`'\\''`, `'`);
  return shellQuote(text) === word ? text : null;
}

/**
 * The machine-side command inside a `jumpCommand(target, …)`, or null when
 * `command` is not one. For the Demo, which answers a machine's commands the
 * way a host would: by the same builder, so a change to the jump cannot
 * silently leave the Demo answering a shape the app no longer sends.
 */
export function unwrapJump(target: string, command: string): string | null {
  const prefix = jumpCommand(target, '').slice(0, -shellQuote('').length);
  if (!command.startsWith(prefix)) return null;
  const inner = unquoteWord(command.slice(prefix.length));
  return inner !== null && jumpCommand(target, inner) === command ? inner : null;
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
 * Bind a host's transport to one of its machines.
 *
 * `ssh` returns the machine's command's exit status, and 255 for its own
 * failure: the host could not reach the machine, or lost it. That is turned
 * into a `connect_failed` result here rather than in `client.ts`, because the
 * transcript store, the socket bridge and the picture upload reach the machine
 * through this transport without passing through the client, and each would
 * otherwise read 255 as a command that failed on the host. A command on the
 * machine that itself exits 255 reads the same way; nothing the app runs does.
 *
 * A stream's exit status is not reported to its reader, so a stream to an
 * unreachable machine simply ends, as a stream to a host that drops does, and
 * the tail watchdog treats it the same.
 *
 * Each command's deadline is its own plus the jump's connect timeout.
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
      const result = await transport.exec(jumpCommand(target, command), timeoutMs + JUMP_CONNECT_TIMEOUT_MS);
      if (result.ok && result.exitCode === SSH_FAILED_EXIT) {
        return { ok: false, code: 'connect_failed', message: machineUnreachableMessage(names) };
      }
      return result;
    },
    streamLines: (command, startTimeoutMs, signal) =>
      transport.streamLines(jumpStream(target, command), startTimeoutMs + JUMP_CONNECT_TIMEOUT_MS, signal),
  };
}
