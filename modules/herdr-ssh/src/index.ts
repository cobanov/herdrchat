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

export function exec(id: string, command: string): Promise<ExecResult> {
  return HerdrSshModule.exec(id, command);
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
 * Breaking out of the loop (or calling `.return()`) stops the remote command.
 */
export async function* streamLines(
  id: string,
  command: string
): AsyncGenerator<string, void, void> {
  const streamId = `s${++streamCounter}`;

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

  try {
    const started = await HerdrSshModule.startStream(id, streamId, command);
    if (!started.ok) {
      throw new SshStreamError(started);
    }

    for (;;) {
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
    cleanup();
    await HerdrSshModule.stopStream(streamId).catch(() => {
      // The stream may already be gone (host dropped, app suspended). Tearing
      // down an absent stream is the expected case here, not a problem.
    });
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
