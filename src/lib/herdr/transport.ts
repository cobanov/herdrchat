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
  /** Run a shell command and return its stdout, stderr and exit status. */
  exec(command: string): Promise<ExecResult>;
  /** Run a long-lived command (e.g. `tail -f`) and yield its stdout lines. */
  streamLines(command: string): AsyncIterable<string>;
}
