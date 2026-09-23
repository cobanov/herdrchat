import { HerdrError, decodeEnvelope, herdrErrorFrom } from './protocol';
import { shellQuote, withPath } from './shell';
import type { HerdrTransport } from './transport';

/**
 * The herdr socket API, reached over the same SSH connection as everything
 * else.
 *
 * Why not the CLI. `herdr agent prompt`, `herdr agent list` and friends are
 * wrappers around this socket, and every one of them costs a `--help` probe to
 * learn whether the host's herdr has the verb, plus a parse of whatever it
 * chose to print. The socket answers one JSON line with one JSON line, reports
 * a missing method as `invalid_request` by name, and is the only place
 * `events.subscribe` exists at all — the CLI has no streaming verb, which is
 * why the app has been polling.
 *
 * Measured 2026-09-14 against upstream 0.9.0 and the jerryfane preview.
 * The socket is single-shot:
 * one request per connection. Only `events.subscribe` keeps it open.
 *
 * HOW A REQUEST GETS TO THE SOCKET. Nothing on the phone can open a Unix
 * socket on the host, so a small program on the host does it. Two candidates,
 * probed once per client:
 *
 * - `python3`: a six-line bridge passed on the command line. Present on every
 *   Linux herdr runs on and on any Mac with the developer tools. 17 ms per
 *   round-trip on loopback.
 * - `herdr api-bridge`: the jerryfane fork's own subcommand. Fastest, but
 *   fork-only; upstream answers `unknown command`.
 *
 * `nc -U` was measured and rejected: macOS `nc` exits at stdin EOF, so a
 * request that takes longer than the write (`agent.prompt` with `wait`, any
 * subscription) came back empty.
 *
 * Neither bridge on a host is not an error here. `detect()` says so and the
 * client stays on its CLI path, which shipped for months.
 */
export class HerdrSocket {
  private detection: Promise<SocketRoute | null> | null = null;
  private sequence = 0;

  constructor(
    private readonly transport: HerdrTransport,
    /** The `herdr` executable name/path on the host, for `status server` and the fork bridge. */
    private readonly herdr: string
  ) {}

  /**
   * How requests reach the socket on this host, or null when they cannot.
   *
   * Memoised only when the host ANSWERED. A probe that failed to reach the host
   * is a fact about one moment of the network, and caching it would pin the
   * client to the CLI path for its whole lifetime.
   */
  detect(): Promise<SocketRoute | null> {
    if (this.detection === null) {
      this.detection = this.probe().then((route) => {
        if (route === 'unreachable') {
          this.detection = null;
          return null;
        }
        return route;
      });
    }
    return this.detection;
  }

  /**
   * One request, one response. The result payload of the envelope, or a
   * `HerdrError` carrying the server's own code.
   *
   * @throws {HerdrError} `socket_unavailable` when the host has no bridge — the
   * caller decides whether that means "use the CLI" or "give up".
   */
  async call(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const route = await this.detect();
    if (route === null) {
      throw new HerdrError('socket_unavailable', 'This host has no way to reach the herdr socket.');
    }
    const request = this.encode(method, params);
    const result = await this.transport.exec(commandFor(route, request, this.herdr), timeoutMs);
    if (!result.ok) {
      throw new HerdrError(result.code, result.message, { transport: true });
    }
    if (result.exitCode !== 0) {
      // The python bridge prints connect failures as an envelope on stdout and
      // exits 1; the fork bridge prints its own on stderr. Either is a better
      // answer than the exit code.
      throw (
        herdrErrorFrom(result.stdout) ??
        herdrErrorFrom(result.stderr) ??
        new HerdrError(
          'ssh_command_failed',
          `The socket bridge failed on the host (exit ${result.exitCode}): ${firstLine(result.stderr)}`
        )
      );
    }
    return decodeEnvelope(result.stdout);
  }

  /**
   * Hold `events.subscribe` open and yield each event as it arrives.
   *
   * The first line the server sends is the `subscription_started` envelope;
   * it is consumed here, so the iterable yields events only.
   *
   * Refusals: an entry herdr cannot parse (an unknown event type, for one)
   * makes it refuse the whole request, so the first line is an error envelope
   * and this throws. Older builds reported an entry that failed its start
   * probe (a pane that closed between the list and the subscribe) mid-stream,
   * with an id of the form `<id>:sub:<n>:probe`; that is yielded as a
   * `refused` event rather than thrown. Newer builds (herdr #4353) refuse the
   * whole request with the original id instead.
   *
   * @throws {HerdrError} `socket_unavailable` when the host has no bridge, or
   * whatever the server said when it refused the subscription outright.
   */
  async *subscribe(
    subscriptions: readonly Subscription[],
    startTimeoutMs: number,
    signal?: AbortSignal
  ): AsyncIterable<SocketEvent> {
    if (signal?.aborted) return;
    const route = await this.detect();
    if (signal?.aborted) return;
    if (route === null) {
      throw new HerdrError('socket_unavailable', 'This host has no way to reach the herdr socket.');
    }
    const request = this.encode('events.subscribe', { subscriptions });
    let started = false;
    for await (const line of this.transport.streamLines(
      commandFor(route, request, this.herdr),
      startTimeoutMs,
      signal
    )) {
      const text = line.trim();
      if (text.length === 0) continue;
      if (!started) {
        // Throws with the server's code if the subscription was refused.
        decodeEnvelope(text);
        started = true;
        continue;
      }
      const event = decodeEvent(text);
      if (event !== null) yield event;
    }
  }

  private encode(method: string, params: Record<string, unknown>): string {
    this.sequence += 1;
    return JSON.stringify({ id: `hc:${method}:${this.sequence}`, method, params });
  }

  private async probe(): Promise<SocketRoute | null | 'unreachable'> {
    let result;
    try {
      result = await this.transport.exec(withPath(probeScript(this.herdr)), PROBE_TIMEOUT_MS);
    } catch {
      return 'unreachable';
    }
    if (!result.ok) return 'unreachable';
    return parseProbe(result.stdout);
  }
}

/** A way to reach the socket on a host, and where the socket is. */
export interface SocketRoute {
  readonly bridge: 'python3' | 'api-bridge';
  readonly socketPath: string;
}

/** One entry of an `events.subscribe` request. Pane events need a pane id; workspace events take none. */
export interface Subscription {
  readonly type: string;
  readonly pane_id?: string;
}

/** What a subscription connection yields. */
export type SocketEvent =
  | { kind: 'event'; event: string; data: Record<string, unknown> }
  /** The server declined one subscription entry; the rest are still live. */
  | { kind: 'refused'; code: string; message: string };

/**
 * Long enough for `herdr status server` on a cold host, short enough that a
 * host without herdr does not hold up the first poll.
 */
const PROBE_TIMEOUT_MS = 8000;

/**
 * Bytes a single argument may be on the host. Linux caps one argv string at
 * 128 KiB (`MAX_ARG_STRLEN`); macOS is looser but the fork's bridge documents
 * hitting E2BIG at the same figure. Requests here are a prompt plus a few
 * dozen bytes of envelope, so this is a guard, not a budget.
 */
export const MAX_REQUEST_BYTES = 120 * 1024;

/**
 * The shell command that delivers `request` to the socket and prints what
 * comes back, one line per message.
 *
 * Exported for tests, which pin the shape of each bridge without a host.
 */
export function commandFor(route: SocketRoute, request: string, herdr: string): string {
  if (utf8Length(request) > MAX_REQUEST_BYTES) {
    throw new HerdrError(
      'request_too_large',
      'That message is too long to send in one go. Shorten it, or send it in parts.'
    );
  }
  switch (route.bridge) {
    case 'python3':
      // `-S` skips site-packages; the bridge needs only the standard library
      // and a user's broken site file must not break sending a prompt.
      return withPath(
        `python3 -S -c ${shellQuote(PYTHON_BRIDGE)} ${shellQuote(route.socketPath)} ${shellQuote(request)}`
      );
    case 'api-bridge':
      // The fork's bridge resolves the socket itself and takes base64 so the
      // request survives any shell. Run from inside a herdr pane the HERDR_*
      // variables would point it at the pane's own session; a phone is never
      // in one, but the command is the same either way.
      return withPath(`${shellQuote(herdr)} api-bridge ${base64(request)}`);
  }
}

/**
 * The host-side bridge. Connects, writes the request, then copies every line
 * the server sends until it closes — which for a single-shot request is one
 * line, and for `events.subscribe` is the stream.
 *
 * A failure to connect is reported as a herdr error envelope rather than a
 * traceback, so the client can say "herdr isn't running" instead of quoting
 * Python. The code matches the one herdr's CLI uses for the same situation.
 *
 * No single quotes inside: the whole script travels inside one pair.
 */
const PYTHON_BRIDGE = [
  'import socket,sys,json',
  's=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)',
  'try:',
  ' s.connect(sys.argv[1])',
  'except OSError as e:',
  ' print(json.dumps({"id":"bridge","error":{"code":"server_not_running","message":"herdr socket %s: %s"%(sys.argv[1],e.strerror or e)}}));sys.exit(1)',
  's.sendall(sys.argv[2].encode()+b"\\n")',
  'f=s.makefile("rb")',
  'for l in f:',
  ' sys.stdout.write(l.decode("utf-8","replace"));sys.stdout.flush()',
].join('\n');

/**
 * Find a bridge and the socket path in one round-trip. Always exits 0 and
 * prints two lines, because a probe that itself fails tells the client nothing.
 *
 * `herdr status server` is the authority on the socket path (it honours
 * `HERDR_SESSION` and `HERDR_SOCKET_PATH`); the default is the fallback for a
 * host where the server is down and status prints nothing.
 *
 * Apple's `/usr/bin/python3` is a stub that opens an "install the developer
 * tools?" dialog when they are missing, on the host's screen, where nobody is
 * looking. So on Darwin it only counts when `xcode-select -p` says the tools
 * are there. Homebrew's python3 is fine anywhere.
 */
export function probeScript(herdr: string): string {
  const h = shellQuote(herdr);
  return [
    `sock=$(${h} status server 2>/dev/null | sed -n 's/^socket: //p' | head -n 1)`,
    '[ -n "$sock" ] || sock="${HERDR_SOCKET_PATH:-$HOME/.config/herdr/herdr.sock}"',
    'py=$(command -v python3 2>/dev/null)',
    'if [ -n "$py" ] && { [ "$(uname)" != Darwin ] || [ "$py" != /usr/bin/python3 ] || xcode-select -p >/dev/null 2>&1; }; then b=python3',
    `elif ${h} api-bridge >/dev/null 2>&1; then b=api-bridge`,
    'else b=none; fi',
    'echo "BRIDGE $b"; echo "SOCK $sock"',
  ].join('; ');
}

/**
 * Whether a command is the bridge probe. For canned hosts in tests, which count
 * the commands a client runs and should not have to know the probe's text.
 */
export function isSocketProbe(command: string): boolean {
  return command.includes('echo "BRIDGE $b"');
}

/** Exported for tests. */
export function parseProbe(stdout: string): SocketRoute | null {
  let bridge: string | null = null;
  let socketPath: string | null = null;
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('BRIDGE ')) bridge = line.slice(7).trim();
    else if (line.startsWith('SOCK ')) socketPath = line.slice(5).trim();
  }
  if (socketPath === null || socketPath.length === 0) return null;
  if (bridge === 'python3' || bridge === 'api-bridge') return { bridge, socketPath };
  return null;
}

/**
 * One line of a subscription stream, interpreted. Null for lines that are
 * neither an event nor a per-subscription refusal — nothing the server sends
 * today, but a stream is the wrong place to throw on a surprise.
 */
export function decodeEvent(line: string): SocketEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const envelope = parsed as {
    event?: unknown;
    data?: unknown;
    error?: { code?: unknown; message?: unknown };
  };
  if (typeof envelope.event === 'string') {
    const data =
      typeof envelope.data === 'object' && envelope.data !== null
        ? (envelope.data as Record<string, unknown>)
        : {};
    return { kind: 'event', event: envelope.event, data };
  }
  if (envelope.error !== undefined && envelope.error !== null) {
    return {
      kind: 'refused',
      code: typeof envelope.error.code === 'string' ? envelope.error.code : 'unknown',
      message: typeof envelope.error.message === 'string' ? envelope.error.message : '',
    };
  }
  return null;
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? '';
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Standard base64 of the UTF-8 bytes. Hand-rolled because `btoa` takes
 * Latin-1, not UTF-8, and a prompt with an emoji in it must not become a
 * `InvalidCharacterError` three layers up.
 */
export function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(triple >> 18) & 63];
    out += ALPHABET[(triple >> 12) & 63];
    out += b === undefined ? '=' : ALPHABET[(triple >> 6) & 63];
    out += c === undefined ? '=' : ALPHABET[triple & 63];
  }
  return out;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
