import { HerdrError, decodeEnvelope, herdrError, herdrErrorFrom, transportError } from './protocol';
import { commandWord, shellQuote, withPath } from './shell';
import { STREAM_START_TIMEOUT_MS } from './timeouts';
import type { Duplex, HerdrTransport } from './transport';

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
 * socket on the host, so a small program on the host does it. Three
 * candidates, probed once per client, in this order:
 *
 * - `python3`: a six-line bridge passed on the command line. Present on every
 *   Linux herdr runs on and on any Mac with the developer tools. 17 ms per
 *   round-trip on loopback.
 * - `herdr api-bridge`: the jerryfane fork's own subcommand. Fastest, but
 *   fork-only; upstream answers `unknown command`.
 * - `herdr remote-api-bridge`: upstream's own relay, from 0.9.1. What a host
 *   without python3 uses (a Mac without the developer tools, a slim
 *   container), which otherwise fell back to polling the CLI (#116). See
 *   `remoteBridgeCommand` for why it cannot simply be piped a request.
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
  private live: LiveBridge | null = null;
  /** Bridges in a row that ended without answering anything; at `MAX_SILENT_BRIDGES` this host execs. */
  private silentBridges = 0;
  /** Until when this host execs after `MAX_SILENT_BRIDGES`; then it tries a bridge again. */
  private execUntil = 0;

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
    // Built either way: a request too long for the exec path is refused on both.
    const command = commandFor(route, request, this.herdr);
    const live = await this.liveBridge(route, timeoutMs);
    if (live !== null) return decodeEnvelope(await live.ask(request, timeoutMs));
    const result = await this.transport.exec(command, timeoutMs);
    if (!result.ok) {
      throw transportError(result);
    }
    if (result.exitCode !== 0) {
      // The python bridge prints connect failures as an envelope on stdout and
      // exits 1; the fork bridge prints its own on stderr. Either is a better
      // answer than the exit code.
      throw (
        herdrErrorFrom(result.stdout) ??
        herdrErrorFrom(result.stderr) ??
        bridgeStderr(result.stderr) ??
        new HerdrError(
          'ssh_command_failed',
          `The socket bridge failed on the host (exit ${result.exitCode}): ${firstLine(result.stderr)}`
        )
      );
    }
    return decodeEnvelope(result.stdout);
  }

  /**
   * The same request with each of `paramsList`, on ONE SSH channel: the host
   * runs them one after another (`batchCommand`) and each answer comes back
   * in its place, a failure as that entry's error rather than the batch's.
   *
   * For asks fanned out over many panes. One exec per pane, side by side,
   * opened up to one channel per pane at once; OpenSSH allows 10 sessions on
   * a connection (`MaxSessions`), the app already holds several, and a
   * refused channel resets the whole client (PR #164 review). A batch too long
   * for one command is split, and the parts still run one at a time.
   *
   * @throws {HerdrError} `socket_unavailable` when the host has no bridge, or
   * the transport's failure when the first part cannot run at all. A later
   * part that cannot run fails only its own entries.
   */
  async callEach(
    method: string,
    paramsList: readonly Record<string, unknown>[],
    timeoutMs: number
  ): Promise<BatchAnswer[]> {
    return this.callMany(paramsList.map((params) => ({ method, params })), timeoutMs);
  }

  /**
   * Different requests on ONE SSH channel, as `callEach` sends one request
   * with many params: run in order, each answer in its place, a failure as
   * that entry's error. An open chat's poll asks for the snapshot, a screen
   * and its presence at once this way, where it opened a channel for each.
   */
  async callMany(
    requests: readonly { method: string; params: Record<string, unknown> }[],
    timeoutMs: number
  ): Promise<BatchAnswer[]> {
    if (requests.length === 0) return [];
    const route = await this.detect();
    if (route === null) {
      throw new HerdrError('socket_unavailable', 'This host has no way to reach the herdr socket.');
    }
    const encoded = requests.map(({ method, params }) => this.encode(method, params));
    const commands = encoded.map((request) => commandFor(route, request, this.herdr));
    const live = await this.liveBridge(route, timeoutMs);
    if (live === null) return this.runBatches(commands, timeoutMs);
    // All at once: the bridge answers each on its own thread, in any order.
    return Promise.all(encoded.map((request) => live.ask(request, timeoutMs).then(
      (line): BatchAnswer => ({ ok: true, result: decodeEnvelope(line) })
    ).catch((thrown: unknown): BatchAnswer => {
      if (thrown instanceof HerdrError) return { ok: false, error: thrown };
      throw thrown;
    })));
  }

  /**
   * The kept-open bridge (`LiveBridge`), started on first use and again after
   * one ends; null where there is none to have, and the caller execs instead:
   * another route, a transport that cannot write to a command (the
   * Demo), a start that failed, or a host whose bridges kept ending
   * without answering, for `SILENT_BRIDGE_BACKOFF_MS`.
   *
   * Waiting for a start counts against the call's own deadline. The start is
   * not abandoned when it runs out: on a half-open connection the transport's
   * start deadline is what drops the SSH client, as an exec's did.
   */
  private async liveBridge(route: SocketRoute, timeoutMs: number): Promise<LiveBridge | null> {
    if (route.bridge !== 'python3' || this.transport.duplex === undefined) return null;
    if (this.live === null || this.live.ended) {
      if (this.live !== null) this.silentBridges = this.live.answered ? 0 : this.silentBridges + 1;
      if (this.silentBridges >= MAX_SILENT_BRIDGES) {
        // Not for good: one bad stretch of network ends bridges unanswered too.
        this.silentBridges = 0;
        this.execUntil = Date.now() + SILENT_BRIDGE_BACKOFF_MS;
        this.live = null;
      }
      if (Date.now() < this.execUntil) return null;
      const stop = new AbortController();
      this.live = new LiveBridge(
        this.transport.duplex(
          withPath(`python3 -S -u -c ${shellQuote(LIVE_BRIDGE)} ${shellQuote(route.socketPath)}`),
          STREAM_START_TIMEOUT_MS,
          stop.signal
        ),
        () => stop.abort()
      );
    }
    const live = this.live;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), timeoutMs); });
    try {
      if ((await Promise.race([live.started, late])) === 'late') {
        throw transportError({ code: 'timeout', message: `herdr did not answer within ${Math.round(timeoutMs / 1000)} s.` });
      }
      return live;
    } catch (thrown) {
      if (thrown instanceof HerdrError) throw thrown;
      // Nothing was sent; the next call tries again.
      if (this.live === live) this.live = null;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Bridge commands as few batches as fit, run in order; see `callEach`. */
  private async runBatches(commands: readonly string[], timeoutMs: number): Promise<BatchAnswer[]> {
    const answers: BatchAnswer[] = [];
    for (const part of batchParts(commands)) {
      const result = await this.transport.exec(batchCommand(part), timeoutMs);
      if (!result.ok) {
        const error = transportError(result);
        if (answers.length === 0) throw error;
        for (let i = answers.length; i < commands.length; i += 1) answers.push({ ok: false, error });
        return answers;
      }
      answers.push(...parseBatch(result.stdout, part.length));
    }
    return answers;
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
        // Said out loud, because events do not replay: whatever changed while
        // no stream was open is only caught by reading the state now (#94).
        yield { kind: 'started' };
        continue;
      }
      const event = decodeEvent(text);
      if (event !== null) yield event;
    }
    if (!started && signal?.aborted !== true) {
      // The bridge exited without the server ever accepting (the fork's bridge
      // prints its errors to stderr, which the reader drops). A clean end here
      // is a failure, or the feed's backoff never engages and it reconnects
      // every second, one SSH channel and one host process each time (#104).
      throw new HerdrError('subscription_ended', 'The event stream closed before it started.');
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

/**
 * The python bridge kept running for the life of the connection (HC-95): a
 * request goes in on its stdin as `<tag>\t<request>` and its answer comes back
 * as `<tag>\t<line>`. An exec opens an SSH channel and starts a host process
 * for every request; this pays for both once. herdr's socket stays
 * single-shot, so the bridge opens a connection per request, each on its own
 * thread, and a slow request (`agent.prompt` waiting) holds up no other.
 *
 * Exported for tests.
 */
export class LiveBridge {
  readonly started: Promise<void>;
  ended = false;
  answered = false;
  private tags = 0;
  private readonly waiting = new Map<string, { resolve: (line: string) => void; reject: (error: HerdrError) => void }>();

  constructor(
    private readonly duplex: Duplex,
    /** Closes the bridge's channel. */
    private readonly stop: () => void = () => {}
  ) {
    this.started = duplex.started;
    void this.read();
  }

  /** The answer line to one request, or the transport's failure: `timeout` means nobody knows if it landed. */
  ask(request: string, timeoutMs: number): Promise<string> {
    if (this.ended) return Promise.reject(bridgeEnded());
    this.tags += 1;
    const tag = `b${this.tags}`;
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(tag);
        reject(transportError({ code: 'timeout', message: `herdr did not answer within ${Math.round(timeoutMs / 1000)} s.` }));
        // Dead from here, as an exec past its deadline dropped the client: on a
        // half-open connection every later request would wait out its own
        // deadline until TCP gave up, minutes later. The next call starts a
        // bridge, whose start deadline drops the SSH client if the link is gone.
        this.end();
      }, timeoutMs);
      const settle = <T,>(done: (value: T) => void) => (value: T) => {
        clearTimeout(timer);
        this.waiting.delete(tag);
        done(value);
      };
      this.waiting.set(tag, { resolve: settle(resolve), reject: settle(reject) });
      this.duplex.write(`${tag}\t${request}\n`).then(
        (written) => { if (!written) this.waiting.get(tag)?.reject(bridgeEnded()); },
        () => this.waiting.get(tag)?.reject(bridgeEnded())
      );
    });
  }

  private async read(): Promise<void> {
    try {
      for await (const line of this.duplex.lines) {
        const tab = line.indexOf('\t');
        if (tab < 0) continue;
        const waiter = this.waiting.get(line.slice(0, tab));
        if (waiter === undefined) continue;
        this.answered = true;
        waiter.resolve(line.slice(tab + 1));
      }
    } catch {
      // Ended either way; what is still waiting is told below.
    }
    this.end();
  }

  /** Ends the bridge: closes its channel and fails what is still waiting. */
  end(): void {
    if (!this.ended) {
      this.ended = true;
      this.stop();
    }
    for (const waiter of [...this.waiting.values()]) waiter.reject(bridgeEnded());
  }
}

function bridgeEnded(): HerdrError {
  return transportError({ code: 'transport_failed', message: 'The connection to herdr on the host closed.' });
}

/**
 * The host side of `LiveBridge`. Bytes throughout, so a request with an emoji
 * survives a host whose locale is not UTF-8. A connect failure is answered as
 * the one-shot bridge answers it, an envelope with herdr's own code.
 *
 * No single quotes inside: the whole script travels inside one pair.
 */
export const LIVE_BRIDGE = [
  'import socket,sys,json,threading',
  'p=sys.argv[1]',
  'o=threading.Lock()',
  'w=sys.stdout.buffer',
  'def say(i,t):',
  ' with o:w.write(i+b"\\t"+t.rstrip(b"\\n")+b"\\n");w.flush()',
  'def fail(i,c,m):',
  ' say(i,json.dumps({"id":i.decode("utf-8","replace"),"error":{"code":c,"message":m}}).encode())',
  'def ask(i,r):',
  ' try:',
  '  s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.connect(p);s.sendall(r+b"\\n");l=s.makefile("rb").readline();s.close()',
  ' except OSError as e:',
  '  return fail(i,"server_not_running","herdr socket %s: %s"%(p,e.strerror or e))',
  ' if l:say(i,l)',
  ' else:fail(i,"empty_response","herdr closed the connection without answering.")',
  'for q in sys.stdin.buffer:',
  ' i,_,r=q.rstrip(b"\\n").partition(b"\\t")',
  ' if r:threading.Thread(target=ask,args=(i,r),daemon=True).start()',
].join('\n');

/** One entry of `callEach`: the envelope's result, or what went wrong for that entry alone. */
export type BatchAnswer = { ok: true; result: unknown } | { ok: false; error: HerdrError };

/** The line a batch prints before entry `index`'s output. */
const BATCH_BEGIN = '@@hc-batch-begin';
/** The line a batch prints after entry `index`'s output, with its exit status. */
const BATCH_END = '@@hc-batch-end';

/**
 * Several bridge commands as one, run in order under `sh` (the login shell may
 * be fish, which has no subshells), each between two marker lines that carry
 * its index and its exit status. Its stderr is folded into its own section,
 * since that is where the fork's bridge says what went wrong, and its stdin is
 * closed, since the channel's is shared. One entry failing does not stop the
 * next. The batch itself always exits 0.
 *
 * Exported for tests.
 */
export function batchCommand(commands: readonly string[]): string {
  const script = commands
    .map((command, index) =>
      `printf '\\n${BATCH_BEGIN} %d\\n' ${index}; ( ${command} ) </dev/null 2>&1; printf '\\n${BATCH_END} %d %d\\n' ${index} "$?"`
    )
    .join('; ');
  return `sh -c ${shellQuote(`${script}; exit 0`)}`;
}

/**
 * The commands, packed in order into as few batches as fit in one command
 * each (`MAX_COMMAND_BYTES`). A single command too long on its own was
 * already refused by `commandFor`.
 */
export function batchParts(commands: readonly string[]): string[][] {
  const parts: string[][] = [];
  let current: string[] = [];
  for (const command of commands) {
    const next = [...current, command];
    if (current.length > 0 && utf8Length(batchCommand(next)) > MAX_COMMAND_BYTES) {
      parts.push(current);
      current = [command];
    } else {
      current = next;
    }
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

/**
 * A batch's output, one answer per entry in order. An entry whose section is
 * missing (the batch was cut short) or holds no envelope is a failure of its
 * own; the others still answer.
 *
 * Exported for tests.
 */
export function parseBatch(stdout: string, count: number): BatchAnswer[] {
  const sections = new Map<number, { lines: string[]; status: number | null }>();
  let open: { lines: string[]; status: number | null } | null = null;
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    const begin = line.startsWith(`${BATCH_BEGIN} `) ? Number(line.slice(BATCH_BEGIN.length + 1)) : null;
    if (begin !== null && Number.isInteger(begin)) {
      open = { lines: [], status: null };
      sections.set(begin, open);
      continue;
    }
    if (line.startsWith(`${BATCH_END} `)) {
      const status = Number(line.split(' ')[2]);
      if (open !== null) open.status = Number.isInteger(status) ? status : null;
      open = null;
      continue;
    }
    if (open !== null && line.length > 0) open.lines.push(line);
  }
  return Array.from({ length: count }, (_, index): BatchAnswer => {
    const section = sections.get(index);
    if (section === undefined || section.status === null) {
      return { ok: false, error: new HerdrError('empty_response', 'The host stopped before answering this request.') };
    }
    const text = section.lines.join('\n');
    const envelope = section.lines.find((line) => line.startsWith('{'));
    if (section.status === 0 && envelope !== undefined) {
      try {
        return { ok: true, result: decodeEnvelope(envelope) };
      } catch (thrown) {
        if (thrown instanceof HerdrError) return { ok: false, error: thrown };
        throw thrown;
      }
    }
    return {
      ok: false,
      error:
        herdrErrorFrom(text) ??
        bridgeStderr(text) ??
        new HerdrError('ssh_command_failed', `The socket bridge failed on the host (exit ${section.status}): ${firstLine(text)}`),
    };
  });
}

/** A way to reach the socket on a host, and where the socket is. */
export interface SocketRoute {
  readonly bridge: 'python3' | 'api-bridge' | 'remote-api-bridge';
  readonly socketPath: string;
}

/** One entry of an `events.subscribe` request. Pane events need a pane id; workspace events take none. */
export interface Subscription {
  readonly type: string;
  readonly pane_id?: string;
}

/** What a subscription connection yields. */
export type SocketEvent =
  /** The server accepted the subscription. Always the first item, exactly once. */
  | { kind: 'started' }
  | { kind: 'event'; event: string; data: Record<string, unknown> }
  /**
   * An error on the stream: an entry the server declined, or `events_lost`
   * (herdr #4225), a subscriber that fell behind and is about to be closed.
   */
  | { kind: 'refused'; code: string; message: string };

/**
 * Bridges that may end in a row without one answer before a client stops
 * starting them. One is a dropped connection; three is a host whose python3
 * cannot run the bridge, where each call would otherwise start one and fail.
 */
const MAX_SILENT_BRIDGES = 3;

/** How long a host execs after `MAX_SILENT_BRIDGES` before it tries a bridge again. */
const SILENT_BRIDGE_BACKOFF_MS = 5 * 60_000;

/**
 * Long enough for `herdr status server` on a cold host, short enough that a
 * host without herdr does not hold up the first poll.
 */
const PROBE_TIMEOUT_MS = 8000;

/**
 * Bytes a whole command may be on the host. sshd hands the command to the
 * login shell as ONE argument (`$SHELL -c <command>`), and Linux caps one argv
 * string at 128 KiB (`MAX_ARG_STRLEN`); macOS is looser but the fork's bridge
 * documents hitting E2BIG at the same figure. A little is kept back for what
 * the transport adds around the command (the session prefix, the done mark).
 *
 * Checked on the finished command, not the request: the api-bridge route
 * base64s the request (4/3 larger) and quoting grows every `'` fourfold, so
 * prompts of roughly 96-120 KiB used to pass a check on the request and then
 * fail on the host (#105).
 */
export const MAX_COMMAND_BYTES = 126 * 1024;

/**
 * The shell command that delivers `request` to the socket and prints what
 * comes back, one line per message.
 *
 * Exported for tests, which pin the shape of each bridge without a host.
 */
export function commandFor(route: SocketRoute, request: string, herdr: string): string {
  const command = bridgeCommand(route, request, herdr);
  if (utf8Length(command) > MAX_COMMAND_BYTES) throw tooLarge();
  return command;
}

/** The refusal for a message too long to send in one command. */
export function tooLarge(): HerdrError {
  return new HerdrError(
    'request_too_large',
    'That message is too long to send in one go. Shorten it, or send it in parts.'
  );
}

/** The request as the host will receive it, for this route. */
function bridgeCommand(route: SocketRoute, request: string, herdr: string): string {
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
      return withPath(`${commandWord(herdr)} api-bridge ${base64(request)}`);
    case 'remote-api-bridge':
      return withPath(remoteBridgeCommand(herdr, request));
  }
}

/**
 * Upstream's bridge copies stdin to the socket and the socket to stdout, and
 * the server takes the end of stdin as the client leaving. Measured on 0.9.1:
 * piped a request, a subscription stopped right after `subscription_started`,
 * and a request that waits (`agent.prompt` with `wait`) came back with no
 * output at all, exit 0.
 *
 * So stdin is a FIFO held open by a sleeping writer. Holding it with a pipe
 * from `sleep` would work too, but the shell waits for every member of a
 * pipeline and the answer would sit there until the sleep ran out; here the
 * holder is killed (and reaped quietly) as soon as the bridge exits, and the
 * bridge's own status is the command's. Checked under sh, dash, bash and zsh.
 */
function remoteBridgeCommand(herdr: string, request: string): string {
  return [
    'd=$(mktemp -d) && mkfifo "$d/in" && {',
    `{ printf '%s\n' ${shellQuote(request)}; exec sleep 2147483647; } > "$d/in" & h=$!;`,
    `${commandWord(herdr)} remote-api-bridge < "$d/in"; s=$?;`,
    'kill "$h" 2>/dev/null; wait "$h" 2>/dev/null; rm -rf "$d"; (exit "$s"); }',
  ].join(' ');
}

/**
 * What a bridge's stderr says, when it is something the app has a word for.
 * Upstream's bridge reports a missing socket as a Rust error, not an envelope.
 */
function bridgeStderr(stderr: string): HerdrError | null {
  if (stderr.includes('failed to connect to remote Herdr API socket')) {
    return herdrError('server_not_running', firstLine(stderr));
  }
  return null;
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
 *
 * A Windows host (Git Bash, MSYS, Cygwin) never gets the python bridge:
 * Windows CPython has no `AF_UNIX`, and stock Windows answers `command -v
 * python3` with the Microsoft Store stub, which exits 49 (#158). Nor herdr's
 * `remote-api-bridge`, which passes its check there and then answers nothing
 * (herdrdev/herdr#5128). So it lands on the CLI: polling, no live events.
 * shortcut: Windows skips remote-api-bridge outright; drop that once herdr#5128 ships a fix.
 */
export function probeScript(herdr: string): string {
  const h = commandWord(herdr);
  return [
    `sock=$(${h} status server 2>/dev/null | sed -n 's/^socket: //p' | head -n 1)`,
    '[ -n "$sock" ] || sock="${HERDR_SOCKET_PATH:-$HOME/.config/herdr/herdr.sock}"',
    'case "$(uname)" in MINGW*|MSYS*|CYGWIN*) win=1; py= ;; *) win=; py=$(command -v python3 2>/dev/null) ;; esac',
    'if [ -n "$py" ] && { [ "$(uname)" != Darwin ] || [ "$py" != /usr/bin/python3 ] || xcode-select -p >/dev/null 2>&1; }; then b=python3',
    `elif ${h} api-bridge >/dev/null 2>&1; then b=api-bridge`,
    `elif [ -z "$win" ] && [ "$(${h} remote-api-bridge --check </dev/null 2>/dev/null)" = herdr-api-bridge-v1 ]; then b=remote-api-bridge`,
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
  if (bridge === 'python3' || bridge === 'api-bridge' || bridge === 'remote-api-bridge') {
    return { bridge, socketPath };
  }
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

export function utf8Length(text: string): number {
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

/**
 * The text whose UTF-8 bytes `encoded` is the standard base64 of: `base64`
 * backwards, for the Demo host, which plays the host's `base64 -d`. Null for
 * anything that is not base64 of UTF-8.
 */
export function textFromBase64(encoded: string): string | null {
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
  let escaped = '';
  for (let i = 0; i < encoded.length; i += 4) {
    const quad = encoded.slice(i, i + 4);
    // `=` is not in the alphabet: indexOf gives -1, counted as 0 and its byte dropped.
    const sextet = (at: number) => Math.max(ALPHABET.indexOf(quad.charAt(at)), 0);
    const triple = (sextet(0) << 18) | (sextet(1) << 12) | (sextet(2) << 6) | sextet(3);
    const kept = quad.charAt(2) === '=' ? 1 : quad.charAt(3) === '=' ? 2 : 3;
    const bytes = [(triple >> 16) & 255, (triple >> 8) & 255, triple & 255].slice(0, kept);
    for (const byte of bytes) escaped += `%${byte.toString(16).padStart(2, '0')}`;
  }
  try {
    return decodeURIComponent(escaped);
  } catch {
    return null;
  }
}
