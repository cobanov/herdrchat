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
  readonly code: string;
  /** True when the SSH transport failed, not herdr. */
  readonly transport: boolean;

  constructor(code: string, message: string, options: { transport?: boolean } = {}) {
    super(message);
    this.name = 'HerdrError';
    this.code = code;
    this.transport = options.transport ?? false;
  }

  override toString(): string {
    return `herdr error [${this.code}]: ${this.message}`;
  }
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
      typeof error.code === 'string' ? error.code : 'unknown',
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
      "herdr wasn't found on this account (exit 127). It's likely not installed for this user, or not on PATH. Install herdr on the host, or set its full path in the connection's Advanced settings."
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

  return herdrError(code, message);
}

/** An error with herdr's code, worded for a phone where that differs. */
export function herdrError(code: string, message: string): HerdrError {
  return new HerdrError(code, humanise(code, message));
}

/**
 * herdr's own wording is written for a terminal. These are the cases where a
 * phone needs different words — or where the fix is a thing you do somewhere
 * else entirely, which a message ending in "run `herdr`" does not convey when
 * there is no terminal in front of you.
 */
function humanise(code: string, message: string): string {
  switch (code) {
    case 'server_not_running':
      // herdr says "run `herdr` to start or attach it", which is correct and
      // unhelpful on a phone: the thing to do is on the other machine.
      return 'herdr isn’t running on this host. Start it there — open a terminal and run `herdr` — then pull to refresh.';
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
