import HerdrSshModule from './HerdrSshModule';
import type {
  ConnectResult,
  ExecResult,
  NativeSshConfig,
  SshConfig,
  SshFailure,
  StreamEndEvent,
  StreamErrorEvent,
  StreamLineEvent,
} from './HerdrSsh.types';

export * from './HerdrSsh.types';

export function connect(id: string, config: SshConfig): Promise<ConnectResult> {
  return HerdrSshModule.connect(id, flatten(config));
}

/**
 * Expo's `Record` decoding has no sum type, so the native side takes a flat
 * struct with an `authKind` tag. Keeping the flattening here lets the public API
 * stay a discriminated union — where the type checker can enforce that a
 * password config carries no PEM and vice versa.
 */
function flatten(config: SshConfig): NativeSshConfig {
  const base = {
    host: config.host,
    port: config.port,
    username: config.username,
    hostKeyFingerprint: config.hostKeyFingerprint ?? null,
  };
  return config.auth.kind === 'password'
    ? { ...base, authKind: 'password', password: config.auth.password }
    : {
        ...base,
        authKind: 'privateKey',
        privateKey: config.auth.pem,
        passphrase: config.auth.passphrase ?? null,
      };
}

export function disconnect(id: string): Promise<void> {
  return HerdrSshModule.disconnect(id);
}

/**
 * Run a command to completion, or give up after `timeoutMs`.
 *
 * The deadline is enforced natively, where the channel can actually be torn
 * down. `SshHerdrTransport` adds a second, slightly later one in JS — see the
 * comment there for why a belt as well as braces.
 */
export function exec(id: string, command: string, timeoutMs: number): Promise<ExecResult> {
  return HerdrSshModule.exec(id, command, timeoutMs);
}

let streamCounter = 0;

/**
 * Run a long-lived command and yield its stdout a line at a time.
 *
 * The native side speaks in events; a transcript tail wants a sequence it can
 * `for await` over and abandon by breaking out of the loop. This adapts one to
 * the other, and — importantly — buffers lines that arrive before the consumer
 * asks for them. A `tail -f` on a file with existing content delivers a burst
 * immediately, and without the buffer those lines would be dropped between the
 * subscription and the first `next()`.
 *
 * Breaking out stops the command. AbortSignal also interrupts an idle read;
 * `.return()` alone queues behind a pending `next()` and cannot do that.
 */
export function streamLines(
  id: string,
  command: string,
  startTimeoutMs: number,
  signal?: AbortSignal
): AsyncGenerator<string, void, void> {
  return streamWith(id, `s${++streamCounter}`, command, startTimeoutMs, signal);
}

/**
 * A long-lived command that is also written to: its stdout lines, and a way
 * to put lines on its stdin. The host's socket bridge takes one request a
 * line this way, so a request costs no new SSH channel or host process.
 * `started` settles once the command runs; a write before it has nowhere to go.
 */
export function duplexLines(
  id: string,
  command: string,
  startTimeoutMs: number,
  signal?: AbortSignal
): { lines: AsyncGenerator<string, void, void>; started: Promise<void>; write: (text: string) => Promise<boolean> } {
  const streamId = `s${++streamCounter}`;
  let settle: { resolve: () => void; reject: (error: unknown) => void } = { resolve: () => undefined, reject: () => undefined };
  const started = new Promise<void>((resolve, reject) => { settle = { resolve, reject }; });
  // Nobody may wait on it: a failed start also throws out of `lines`.
  started.catch(() => undefined);
  return {
    lines: streamWith(id, streamId, command, startTimeoutMs, signal, settle),
    started,
    write: async (text) => (await HerdrSshModule.writeStream(streamId, text)).ok,
  };
}

async function* streamWith(
  id: string,
  streamId: string,
  command: string,
  startTimeoutMs: number,
  signal?: AbortSignal,
  onStart?: { resolve: () => void; reject: (error: unknown) => void }
): AsyncGenerator<string, void, void> {
  if (signal?.aborted) {
    onStart?.reject(new SshStreamError({ ok: false, code: 'transport_failed', message: 'The stream was stopped before it started.' }));
    return;
  }

  const pending: string[] = [];
  let waiting: (() => void) | null = null;
  let finished = false;
  let failure: SshFailure | null = null;

  const wake = () => {
    const resume = waiting;
    waiting = null;
    resume?.();
  };

  const subscriptions = [
    HerdrSshModule.addListener('onStreamLine', (event: StreamLineEvent) => {
      if (event.streamId !== streamId) return;
      pending.push(event.line);
      wake();
    }),
    HerdrSshModule.addListener('onStreamEnd', (event: StreamEndEvent) => {
      if (event.streamId !== streamId) return;
      finished = true;
      wake();
    }),
    HerdrSshModule.addListener('onStreamError', (event: StreamErrorEvent) => {
      if (event.streamId !== streamId) return;
      failure = { ok: false, code: event.code, message: event.message };
      finished = true;
      wake();
    }),
  ];

  const cleanup = () => {
    subscriptions.forEach((subscription) => subscription.remove());
  };

  const stop = () => HerdrSshModule.stopStream(streamId).catch(() => undefined);
  const abort = () => {
    finished = true;
    pending.length = 0;
    wake();
    // Also stop when the consumer is paused at a yield, not only at next().
    void stop();
  };
  signal?.addEventListener('abort', abort);

  try {
    let started: Awaited<ReturnType<typeof HerdrSshModule.startStream>>;
    try {
      started = await HerdrSshModule.startStream(id, streamId, command, startTimeoutMs);
    } catch (error) {
      onStart?.reject(error);
      throw error;
    }
    if (signal?.aborted) {
      onStart?.reject(new SshStreamError({ ok: false, code: 'transport_failed', message: 'The stream was stopped before it started.' }));
      return;
    }
    if (!started.ok) {
      const error = new SshStreamError(started);
      onStart?.reject(error);
      throw error;
    }
    onStart?.resolve();

    for (;;) {
      if (signal?.aborted) return;
      while (pending.length > 0) {
        // Non-null: guarded by the length check, and nothing else shifts here.
        yield pending.shift() as string;
      }
      if (failure !== null) throw new SshStreamError(failure);
      if (finished) return;
      await new Promise<void>((resolve) => {
        waiting = resolve;
      });
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    cleanup();
    // Repeat after an aborted start: native may have registered the handle
    // only after the first stop request. Stopping an absent stream is safe.
    await stop();
  }
}

/** Thrown out of {@link streamLines} when the stream could not start or died. */
export class SshStreamError extends Error {
  readonly code: SshFailure['code'];

  constructor(failure: SshFailure) {
    super(failure.message);
    this.name = 'SshStreamError';
    this.code = failure.code;
  }
}

export {
  DEFAULT_TERM,
  DEMO_CONNECTION,
  base64FromBytes,
  closeShell,
  openShell,
  resizeShell,
  utf8Bytes,
  writeShell,
  writeShellText,
  type OpenShellOptions,
} from './shell';
