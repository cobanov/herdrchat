/**
 * The herdr socket API is newline-delimited JSON. Every response is either a
 * `{id, result}` success or a `{id, error}` failure. The CLI (`herdr api …`,
 * `herdr agent …`) wraps its output in the same envelope, so this decodes both
 * the raw socket stream and CLI stdout.
 *
 * Wire protocol pinned during development: protocol 16, schema_version 1.
 */

/** An error herdr itself reported, as opposed to a transport failure. */
export class HerdrError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'HerdrError';
    this.code = code;
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
