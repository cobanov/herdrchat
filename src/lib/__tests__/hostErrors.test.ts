import { exitCodeError, herdrErrorFrom } from '../herdr/client';

/**
 * What a phone shows when the host says no.
 *
 * Reported from a real device: the chat list displayed
 *
 *   The command failed on the host (exit 1): {"id":"cli:api:snapshot","error":
 *   {"code":"server_not_running","message":"no herdr server is running at …
 *
 * herdr had said precisely what was wrong, in a structured field, and the app
 * showed the JSON. Reproduced exactly on 0.8.0: the envelope goes to STDERR and
 * the process exits 1.
 */
const REAL_STDERR =
  '{"id":"cli:api:snapshot","error":{"code":"server_not_running","message":"no herdr server is running at /Users/cobanov/.config/herdr/herdr.sock; run `herdr` to start or attach it"}}';

describe('herdrErrorFrom', () => {
  it('pulls the code out of the envelope herdr actually writes', () => {
    expect(herdrErrorFrom(REAL_STDERR)?.code).toBe('server_not_running');
  });

  it('finds the envelope even behind a shell warning', () => {
    // A login shell can print anything before the command's own output.
    const noisy = `bash: warning: setlocale failed\n${REAL_STDERR}`;
    expect(herdrErrorFrom(noisy)?.code).toBe('server_not_running');
  });

  it('returns null for output that is not an envelope', () => {
    for (const noise of ['', 'Permission denied (publickey).', 'not json {', '{"id":"x"}']) {
      expect(herdrErrorFrom(noise)).toBeNull();
    }
  });

  it('keeps herdr’s own words for a code we have no opinion about', () => {
    // Its message is usually the most specific thing anyone has about a failure
    // nobody anticipated. Flattening it into a generic apology loses that.
    const envelope = '{"error":{"code":"weird_thing","message":"the flux capacitor fell off"}}';
    expect(herdrErrorFrom(envelope)?.message).toBe('the flux capacitor fell off');
  });

  it('falls back to the code when even the message is missing', () => {
    expect(herdrErrorFrom('{"error":{"code":"bare"}}')?.message).toContain('bare');
  });
});

describe('exitCodeError', () => {
  it('never shows raw JSON to a person', () => {
    // The actual regression. Whatever else changes, this must hold.
    const error = exitCodeError(1, REAL_STDERR);
    expect(error.message).not.toContain('{');
    expect(error.message).not.toContain('"code"');
  });

  it('says where to fix a stopped server, not just that it is stopped', () => {
    // herdr says "run `herdr` to start or attach it" — correct, and unhelpful on
    // a phone, because the terminal it means is on another machine.
    const error = exitCodeError(1, REAL_STDERR);
    expect(error.code).toBe('server_not_running');
    expect(error.message).toMatch(/on this host/i);
  });

  it('still diagnoses a missing binary from the exit code alone', () => {
    // 127 arrives with no envelope, because herdr never ran.
    expect(exitCodeError(127, '').code).toBe('herdr_not_found');
  });

  it('falls back to the exit code when stderr carries nothing structured', () => {
    expect(exitCodeError(2, 'Killed').message).toContain('exit 2');
    expect(exitCodeError(2, '').message).toContain('exit 2');
  });
});
