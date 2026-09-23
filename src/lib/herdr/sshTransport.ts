import {
  connect,
  disconnect,
  exec,
  streamLines,
  type ConnectResult,
  type ExecResult,
  type SshConfig,
} from '../../../modules/herdr-ssh/src';
import { checkDoneMark, withDoneMark } from './doneMark';
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
    private readonly onFingerprint?: (fingerprint: string) => void | Promise<void>
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
        .then(async (result): Promise<ConnectResult> => {
          if (result.ok) {
            // A connection we cannot name is a connection we cannot pin. Storing
            // an empty fingerprint would read back as "no pin" — trust-on-first-
            // use, re-armed on every connect — so this is a failure to surface,
            // not a value to persist.
            if (result.fingerprint.length === 0) {
              // Drop the native session too. It authenticated, so the module has
              // it cached and the next connect short-circuits on it — the host
              // key would never be validated again and this same refusal would
              // repeat for the life of the process. Forgetting it here is what
              // makes the next attempt a real handshake.
              await disconnect(this.id);
              this.opening = null;
              return {
                ok: false,
                code: 'connect_failed',
                message: "The host connected but reported no key fingerprint, so its identity can't be checked.",
              };
            }
            await this.onFingerprint?.(result.fingerprint);
          } else {
            // Let the next call retry rather than caching a failure forever —
            // the usual reason is that the phone wasn't on the tailnet yet.
            this.opening = null;
          }
          return result;
        })
        .catch(async (thrown: unknown): Promise<ConnectResult> => {
          // Everything before the handshake can throw — reading the config, a
          // keychain that will not answer. Without this the REJECTED promise
          // stays in `opening` and every later command on this host rejects
          // from cache until the app restarts, which is the one failure mode a
          // transport must not have. Same shape as any other expected failure.
          // In particular, a failed pin write must not leave an authenticated
          // native connection usable by the next caller.
          await disconnect(this.id).catch(() => undefined);
          this.opening = null;
          return {
            ok: false,
            code: thrown instanceof MissingCredentialsError ? 'credentials_missing' : 'connect_failed',
            message: thrown instanceof Error ? thrown.message : String(thrown),
          };
        });
    }
    return this.opening;
  }

  /**
   * Run a command, and make it SAY that it finished.
   *
   * The iOS SSH library reports a command killed by a signal as exit 0 (it
   * ignores SSH's `exit-signal`), so a herdr that crashed mid-write looked
   * like a success, and so did a read cut short, which then looked complete
   * (#103). Every command therefore ends in `&& printf <mark>`, which prints
   * only when it exited 0. An exit 0 without the mark is a command that was
   * killed. `&&` behaves the same in sh, bash, zsh and fish, where `$?` would
   * not. Non-zero exits pass through untouched: they already say what they
   * mean.
   */
  async exec(command: string, timeoutMs: number): Promise<ExecResult> {
    const opened = await this.open();
    if (!opened.ok) return opened;
    const result = await withJsDeadline(exec(this.id, withDoneMark(command), timeoutMs), timeoutMs);
    return checkDoneMark(result);
  }

  async *streamLines(command: string, startTimeoutMs: number, signal?: AbortSignal): AsyncIterable<string> {
    if (signal?.aborted) return;
    const opened = await this.open();
    if (signal?.aborted) return;
    if (!opened.ok) {
      throw new Error(opened.message);
    }
    yield* streamLines(this.id, command, startTimeoutMs, signal);
  }

  async close(): Promise<void> {
    this.opening = null;
    await disconnect(this.id);
  }
}

/**
 * Thrown by a config loader when the host's key or password is not on this
 * device. Restoring a backup to a new iPhone brings back the hosts (they live
 * in SQLite) but not their secrets (device-only keychain items), and
 * connecting with an empty password only produced a generic authentication
 * failure (#98).
 */
export class MissingCredentialsError extends Error {
  readonly code = 'credentials_missing';
}
