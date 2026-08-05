import type { ExecResult } from '../../../modules/herdr-ssh/src';

/**
 * How commands reach a machine that runs herdr.
 *
 * Everything HerdrChat does is a shell command on that host: `herdr <subcommand>`
 * for control, `tail`/`ls`/`cat` for reading Claude transcripts. An interface
 * rather than the SSH module directly, so the whole core can be tested against a
 * canned host without a socket.
 */
export interface HerdrTransport {
  /**
   * Run a shell command and return its stdout, stderr and exit status.
   *
   * `timeoutMs` is not optional on purpose. Every caller has to state how long
   * this particular command is worth waiting for, because the one thing that
   * must never happen again is a command with no deadline at all — see
   * `timeouts.ts` for what that used to cost.
   */
  exec(command: string, timeoutMs: number): Promise<ExecResult>;
  /**
   * Run a long-lived command (e.g. `tail -f`) and yield its stdout lines.
   *
   * `startTimeoutMs` bounds getting the command running, not the stream, which
   * is unbounded by design.
   */
  streamLines(command: string, startTimeoutMs: number): AsyncIterable<string>;
}
