import {
  connect,
  disconnect,
  exec,
  streamLines,
  type ConnectResult,
  type ExecResult,
  type SshConfig,
} from '../../../modules/herdr-ssh/src';
import type { HerdrTransport } from './transport';
import { withJsDeadline } from './timeouts';

/**
 * A `HerdrTransport` backed by the native SSH module.
 *
 * One of these per server, held for the app's lifetime, because the native side
 * keeps a single reused connection per id and reconnects on demand. Creating a
 * second one for the same server would be harmless but pointless — see
 * `src/state/connections.ts`, which caches them.
 */
export class SshHerdrTransport implements HerdrTransport {
  /** Resolves once the first connect finishes, so callers never race it. */
  private opening: Promise<ConnectResult> | null = null;

  constructor(
    private readonly id: string,
    /**
     * Resolved on first use rather than passed in, because the secret and the
     * host-key pin come from the keychain — an async read. Deferring it is what
     * lets `clientFor` be synchronous, so screens can build a client with
     * `useMemo` instead of an effect that sets state.
     */
    private readonly loadConfig: () => Promise<SshConfig>,
    /** Called with the accepted fingerprint so first contact can be persisted. */
    private readonly onFingerprint?: (fingerprint: string) => void
  ) {}

  /**
   * Ensure the connection is up. Idempotent and safe to call concurrently: the
   * in-flight promise is shared, so ten parallel commands on a cold transport
   * produce one handshake rather than ten.
   */
  async open(): Promise<ConnectResult> {
    if (this.opening === null) {
      this.opening = this.loadConfig()
        .then((config) => connect(this.id, config))
        .then((result): ConnectResult => {
          if (result.ok) {
            // A connection we cannot name is a connection we cannot pin. Storing
            // an empty fingerprint would read back as "no pin" — trust-on-first-
            // use, re-armed on every connect — so this is a failure to surface,
            // not a value to persist.
            if (result.fingerprint.length === 0) {
              this.opening = null;
              // Drop the native session too. It authenticated, so the module has
              // it cached and the next connect short-circuits on it — the host
              // key would never be validated again and this same refusal would
              // repeat for the life of the process. Forgetting it here is what
              // makes the next attempt a real handshake.
              void disconnect(this.id);
              return {
                ok: false,
                code: 'connect_failed',
                message: "The host connected but reported no key fingerprint, so its identity can't be checked.",
              };
            }
            this.onFingerprint?.(result.fingerprint);
          } else {
            // Let the next call retry rather than caching a failure forever —
            // the usual reason is that the phone wasn't on the tailnet yet.
            this.opening = null;
          }
          return result;
        })
        .catch((thrown: unknown): ConnectResult => {
          // Everything before the handshake can throw — reading the config, a
          // keychain that will not answer. Without this the REJECTED promise
          // stays in `opening` and every later command on this host rejects
          // from cache until the app restarts, which is the one failure mode a
          // transport must not have. Same shape as any other expected failure.
          this.opening = null;
          return {
            ok: false,
            code: 'connect_failed',
            message: thrown instanceof Error ? thrown.message : String(thrown),
          };
        });
    }
    return this.opening;
  }

  async exec(command: string, timeoutMs: number): Promise<ExecResult> {
    const opened = await this.open();
    if (!opened.ok) return opened;
    return withJsDeadline(exec(this.id, command, timeoutMs), timeoutMs);
  }

  async *streamLines(command: string, startTimeoutMs: number): AsyncIterable<string> {
    const opened = await this.open();
    if (!opened.ok) {
      throw new Error(opened.message);
    }
    yield* streamLines(this.id, command, startTimeoutMs);
  }

  async close(): Promise<void> {
    this.opening = null;
    await disconnect(this.id);
  }
}
