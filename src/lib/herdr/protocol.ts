import type { SshFailureCode } from '../../../modules/herdr-ssh/src';

/**
 * The herdr socket API is newline-delimited JSON. Every response is either a
 * `{id, result}` success or a `{id, error}` failure. The CLI (`herdr api …`,
 * `herdr agent …`) wraps its output in the same envelope, so this decodes both
 * the raw socket stream and CLI stdout.
 *
 * Wire protocol last measured against a host: protocol 19, schema_version 1,
 * on herdr 0.8.0. The envelope has not changed since protocol 16; what the
 * version gates is which verbs exist, and that lives in `version.ts`.
 */

/**
 * The codes herdr reports that this app reads. herdr can report others: those
 * keep herdr's own words and are never compared (see `herdrErrorFrom`).
 */
type HerdrServerCode =
  | 'agent_blocked'
  | 'agent_input_pending'
  | 'agent_not_found'
  | 'agent_pane_busy'
  | 'agent_prompt_stalled'
  | 'herdr_not_found'
  | 'invalid_request'
  | 'pane_not_found'
  | 'server_not_running'
  | 'unknown_method';

/** The codes this app raises itself, about the host or its files. */
type AppErrorCode =
  | 'agent_prompt_unverifiable'
  | 'codex_launcher_conflict'
  | 'codex_launcher_install_failed'
  | 'codex_session_ambiguous'
  | 'codex_session_compressed'
  | 'codex_session_invalid'
  | 'codex_session_mismatch'
  | 'dir_unreadable'
  | 'empty_response'
  | 'grok_session_ambiguous'
  | 'grok_session_invalid'
  | 'herdr_not_executable'
  | 'herdr_not_on_path'
  | 'home_unknown'
  | 'interrupt_unconfirmed'
  | 'omp_session_ambiguous'
  | 'omp_session_invalid'
  | 'omp_session_mismatch'
  | 'push_registration_failed'
  | 'send_keys_failed'
  | 'server_start_failed'
  | 'session_invalid'
  | 'snapshot_missing'
  | 'socket_unavailable'
  | 'ssh_command_failed'
  | 'subscription_ended'
  | 'transcript_absent'
  | 'transcript_changed'
  | 'transcript_tools_missing'
  | 'transcript_unreadable'
  | 'unknown'
  | 'unparseable_response';

/**
 * Every code a `HerdrError` can carry. A union, so a misspelt code in a
 * comparison or a `new HerdrError` fails the typecheck.
 */
export type HerdrErrorCode = SshFailureCode | HerdrServerCode | AppErrorCode;

/**
 * An error from a herdr request. Usually one herdr itself reported; with
 * `transport` set, the SSH layer failed instead (a timeout, a dropped
 * channel) and herdr may never have answered.
 *
 * The difference matters for writes. herdr's own `timeout` on `agent.prompt`
 * means it watched and nothing moved; the transport's `timeout` means nobody
 * knows whether the prompt landed, and treating the second like the first is
 * how a retry sent a prompt twice (#83). The code is kept as it is, so
 * anything that maps codes to messages still reads the same.
 */
export class HerdrError extends Error {
  readonly code: HerdrErrorCode;
  /** True when the SSH transport failed, not herdr. */
  readonly transport: boolean;
  /** On `host_key_changed`: the fingerprint the host presented instead of the pin. */
  readonly presentedFingerprint: string | null;

  constructor(
    code: HerdrErrorCode,
    message: string,
    options: { transport?: boolean; presentedFingerprint?: string | null } = {}
  ) {
    super(message);
    this.name = 'HerdrError';
    this.code = code;
    this.transport = options.transport ?? false;
    this.presentedFingerprint = options.presentedFingerprint ?? null;
  }

  override toString(): string {
    return `herdr error [${this.code}]: ${this.message}`;
  }
}

/** A thrown value, as something a person can read. */
export function errorText(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/**
 * Unwrap one CLI/socket response into its result payload.
 *
 * @throws {HerdrError} when the envelope carried an error, or when the output
 * isn't a herdr envelope at all — a host that printed a shell warning ahead of
 * the JSON should surface as a clear failure rather than a confusing `undefined`
 * three layers up.
 */
export function decodeEnvelope(output: string): unknown {
  const text = output.trim();
  if (text.length === 0) {
    throw new HerdrError('empty_response', 'The host returned no output.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new HerdrError('unparseable_response', `The host's reply wasn't JSON: ${preview(text)}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new HerdrError('unparseable_response', `Unexpected reply shape: ${preview(text)}`);
  }

  const envelope = parsed as { result?: unknown; error?: unknown };
  if (envelope.error !== undefined && envelope.error !== null) {
    const error = envelope.error as { code?: unknown; message?: unknown };
    throw new HerdrError(
      typeof error.code === 'string' ? wireCode(error.code) : 'unknown',
      typeof error.message === 'string' ? error.message : 'herdr reported an error.'
    );
  }
  if (envelope.result === undefined || envelope.result === null) {
    throw new HerdrError('empty_response', 'Response had neither result nor error.');
  }
  return envelope.result;
}

/**
 * Surface a transported error for a command that prints NOTHING on success
 * (`pane run`, `send-keys`). Empty output is the success case here, so only a
 * non-empty reply is inspected.
 */
export function checkEnvelope(output: string): void {
  if (output.trim().length === 0) return;
  decodeEnvelope(output);
}

function preview(text: string): string {
  const oneLine = text.replaceAll('\n', ' ').trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
}

/**
 * Turn a non-zero exit into a helpful message. Exit 127 = "command not found",
 * which for us almost always means `herdr` isn't installed on this account (or
 * isn't on PATH) — spell that out instead of a bare code, because it has a
 * one-tap recovery.
 */
export function exitCodeError(exitCode: number, stderr = ''): HerdrError {
  if (exitCode === 127) {
    return new HerdrError(
      'herdr_not_found',
      "herdr wasn't found on this account. Install it on the host, or set its full path as this host's herdr path."
    );
  }

  // herdr reports its OWN failures as a JSON envelope on stderr and exits
  // non-zero. Treating that as opaque text is how a phone ended up showing
  //
  //   The command failed on the host (exit 1): {"id":"cli:api:snapshot",…}
  //
  // when herdr had said, in a structured field, exactly what was wrong. Decode
  // it before falling back to the exit code, which carries no information the
  // envelope does not.
  const structured = herdrErrorFrom(stderr);
  if (structured !== null) return structured;

  const detail = stderr.trim().split('\n')[0] ?? '';
  return new HerdrError(
    'ssh_command_failed',
    detail.length > 0
      ? `The command failed on the host (exit ${exitCode}): ${detail}`
      : `The command failed on the host (exit ${exitCode}).`
  );
}

/**
 * A code as herdr sent it. Typed as one of ours although herdr may send a
 * code no list here has: such a code matches no comparison, so it only ever
 * reaches a person as herdr's own words.
 */
function wireCode(code: string): HerdrErrorCode {
  return code as HerdrErrorCode;
}

/**
 * A herdr error envelope found in command output, interpreted.
 *
 * Null when the output is not an envelope — a shell warning, an SSH banner,
 * anything else — so the caller can fall back rather than mistaking noise for a
 * diagnosis.
 *
 * The interpretation lives here rather than at the call sites for the same
 * reason `exit 127 -> "herdr isn't installed here"` does: a code is a fact and a
 * sentence is a decision, and the decision should be made once where a test can
 * pin it.
 */
export function herdrErrorFrom(output: string): HerdrError | null {
  const line = output
    .split('\n')
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith('{') && candidate.includes('"error"'));
  if (line === undefined) return null;

  let code: string;
  let message: string;
  try {
    const parsed = JSON.parse(line) as { error?: { code?: unknown; message?: unknown } };
    if (typeof parsed.error?.code !== 'string') return null;
    code = parsed.error.code;
    message = typeof parsed.error.message === 'string' ? parsed.error.message : '';
  } catch {
    return null;
  }

  return herdrError(wireCode(code), message);
}

/** An error with herdr's code, worded for a phone where that differs. */
export function herdrError(code: HerdrErrorCode, message: string): HerdrError {
  return new HerdrError(code, humanise(code, message));
}

/**
 * herdr's own wording is written for a terminal. These are the cases where a
 * phone needs different words — or where the fix is a thing you do somewhere
 * else entirely, which a message ending in "run `herdr`" does not convey when
 * there is no terminal in front of you.
 */
function humanise(code: HerdrErrorCode, message: string): string {
  switch (code) {
    case 'server_not_running':
      // herdr says "run `herdr` to start or attach it", which is correct and
      // unhelpful on a phone: the thing to do is on the other machine.
      // Not "run `herdr`": for a named session that starts the wrong one. The
      // app can start the right one itself (Start herdr on the host).
      return 'herdr isn’t running for this session on this host. Start it from here, or on the host itself, then pull to refresh.';
    case 'pane_not_found':
      return 'That pane is gone. The agent may have been closed on the host.';
    case 'agent_not_found':
      return 'No agent is running in that pane any more.';
    default:
      // Unknown codes keep herdr's own words rather than being flattened into a
      // generic apology — its message is usually the most specific thing anyone
      // has about a failure nobody anticipated.
      return message.length > 0 ? message : `herdr reported: ${code}`;
  }
}

/** A failed transport result as an error, keeping what the native side knew. */
export function transportError(failure: { code: SshFailureCode; message: string; presentedFingerprint?: string }): HerdrError {
  return new HerdrError(failure.code, failure.message, {
    transport: true,
    presentedFingerprint: failure.presentedFingerprint ?? null,
  });
}
