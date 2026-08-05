/**
 * How to reach a herdr host over SSH. This is the whole network surface of the
 * app: the phone and the host are peers on a tailnet, so `host` is normally a
 * Tailscale address and nothing is exposed publicly.
 */
export interface SshConfig {
  host: string;
  port: number;
  username: string;
  auth: SshAuth;
  /**
   * Trust-on-first-use pin: the SHA-256 fingerprint (base64) recorded the first
   * time we connected to this host. When set, a server presenting a different
   * key is refused. When null/undefined, the first key seen is trusted and
   * returned in `ConnectSuccess.fingerprint` for the caller to persist.
   */
  hostKeyFingerprint?: string | null;
}

export type SshAuth =
  | { kind: 'password'; password: string }
  /** OpenSSH-format private key (ed25519 or RSA), e.g. `~/.ssh/id_ed25519`. */
  | { kind: 'privateKey'; pem: string; passphrase?: string | null };

/**
 * The shape the native side actually receives. Expo's `Record` decoding has no
 * sum type, so `SshAuth` is flattened into an `authKind` tag plus optional
 * fields. Callers use `SshConfig`; this exists so the flattening is type-checked
 * rather than assumed.
 */
export type NativeSshConfig = {
  host: string;
  port: number;
  username: string;
  hostKeyFingerprint: string | null;
} & (
  | { authKind: 'password'; password: string }
  | { authKind: 'privateKey'; privateKey: string; passphrase: string | null }
);

/**
 * Why an operation could not be completed. Native code never throws for these —
 * they are expected outcomes of talking to someone else's machine, and the
 * policy for what each one means to the user lives in TypeScript, where it can
 * be tested.
 */
export type SshFailureCode =
  /** The presented host key differs from the stored pin. Possible MITM. */
  | 'host_key_changed'
  /** TCP/handshake failure: host down, wrong address, not on the tailnet. */
  | 'connect_failed'
  /** The server rejected the key or password. */
  | 'auth_failed'
  /** The private key could not be parsed (wrong format, bad passphrase). */
  | 'bad_key'
  /** A command was issued against an id that has no live connection. */
  | 'not_connected'
  /** The channel died mid-command (dropped socket, suspended app). */
  | 'transport_failed'
  /**
   * The command was still running when its deadline elapsed.
   *
   * Distinct from `transport_failed` because it is the one failure that used
   * not to exist: with no deadline, a half-open TCP — the phone sleeping, a
   * route change, a wedged host — left the command pending forever. The poll
   * loops that drive this app re-arm in a `finally`, so "forever" meant the
   * loop stopped and the screen froze with no error at all.
   */
  | 'timeout';

export interface SshFailure {
  ok: false;
  code: SshFailureCode;
  message: string;
}

export interface ConnectSuccess {
  ok: true;
  /**
   * SHA-256 (base64) of the host key this connection accepted. On first contact
   * the caller persists it as the pin; afterwards it always equals the pin.
   */
  fingerprint: string;
}

export type ConnectResult = ConnectSuccess | SshFailure;

export interface ExecSuccess {
  ok: true;
  stdout: string;
  stderr: string;
  /**
   * The command's exit status. Non-zero is a real result, not an error — `ls`
   * on a missing directory and `herdr` not being installed both come back this
   * way, and each means something different to the caller.
   */
  exitCode: number;
}

export type ExecResult = ExecSuccess | SshFailure;

export type StartStreamResult = { ok: true } | SshFailure;

/** One line of a streamed command's stdout, newline already stripped. */
export interface StreamLineEvent {
  streamId: string;
  line: string;
}

/** The streamed command ended on its own (process exited, EOF). */
export interface StreamEndEvent {
  streamId: string;
  exitCode: number;
}

export interface StreamErrorEvent {
  streamId: string;
  code: SshFailureCode;
  message: string;
}

/**
 * A type alias rather than an interface: Expo's `NativeModule<T>` constrains T
 * to `EventsMap`, which carries an index signature, and an interface has no
 * implicit one.
 */
export type HerdrSshEvents = {
  onStreamLine: (event: StreamLineEvent) => void;
  onStreamEnd: (event: StreamEndEvent) => void;
  onStreamError: (event: StreamErrorEvent) => void;
};
