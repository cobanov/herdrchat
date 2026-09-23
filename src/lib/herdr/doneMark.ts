import type { ExecResult } from '../../../modules/herdr-ssh/src';

/*
 * Making a remote command say that it finished (#103).
 *
 * The iOS SSH library reports a command killed by a signal as exit 0, because
 * it ignores SSH's `exit-signal`. So `SshHerdrTransport` ends every command in
 * `&& printf <mark>`, which prints only when the command exited 0, and treats
 * an exit 0 without the mark as a command that never finished.
 *
 * A script that ends in an explicit `exit 0` would skip the mark too, so host
 * scripts end by falling off the end instead.
 */

/** Printed after a command, and only when it exited 0. */
export const DONE_MARK = '@@HERDRCHAT_DONE';

/** `command`, followed by the mark. Trailing separators would make `&&` a syntax error. */
export function withDoneMark(command: string): string {
  return `${command.replace(/[\s;]+$/, '')} && printf '%s' '${DONE_MARK}'`;
}

/** Strip the mark from a finished command, or report a command that never reached it. */
export function checkDoneMark(result: ExecResult): ExecResult {
  if (!result.ok || result.exitCode !== 0) return result;
  if (result.stdout.endsWith(DONE_MARK)) {
    return { ...result, stdout: result.stdout.slice(0, -DONE_MARK.length) };
  }
  return {
    ok: false,
    code: 'transport_failed',
    message: 'The command on the host stopped before it finished. Check the host, then try again.',
  };
}
