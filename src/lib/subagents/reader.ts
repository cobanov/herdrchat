import { withPath } from '../herdr/shell';
import { POLL_TIMEOUT_MS, SUBAGENT_READ_TIMEOUT_MS } from '../herdr/timeouts';
import type { HerdrTransport } from '../herdr/transport';
import {
  ABSENT_EXIT,
  delegationLinesCommand,
  parseResolveOutput,
  readChangedCommand,
  resolveAgentCommand,
  type ResolvedAgent,
} from './paths';

/**
 * The host side of subagents: which agent a call started, and a workflow
 * run's file. The transcripts themselves are read by `TranscriptStore`, whose
 * byte cursor and windows already handle a growing file.
 *
 * Expected failures are answers, not throws: a missing meta is "starting", a
 * missing run file is "not written yet", and a dropped connection is `null`
 * too, since the caller asks again on its next tick either way.
 */
export class SubagentReader {
  constructor(private readonly transport: HerdrTransport) {}

  /**
   * The agent a `tool_use` started, by the `toolUseId` in its meta. Null until
   * the agent has written its meta, so the caller retries. A found agent is
   * cached for the life of the transport: an agent never changes which call
   * started it.
   */
  async resolve(sessionDir: string, toolUseId: string): Promise<ResolvedAgent | null> {
    const cache = resolvedByTransport.get(this.transport) ?? new Map<string, ResolvedAgent>();
    resolvedByTransport.set(this.transport, cache);
    const key = `${sessionDir}\u0000${toolUseId}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const command = resolveAgentCommand(sessionDir, toolUseId);
    if (command === null) return null;
    const result = await this.transport.exec(withPath(command), POLL_TIMEOUT_MS);
    if (!result.ok || result.exitCode !== 0) return null;
    const resolved = parseResolveOutput(result.stdout, toolUseId);
    if (resolved !== null) cache.set(key, resolved);
    return resolved;
  }

  /**
   * A small file, read again only when it changed: a workflow run's file is
   * polled every few seconds and can be several hundred kilobytes, most of it
   * prompts and results that did not move. `signature` is what the previous
   * read returned; pass null the first time.
   */
  async readIfChanged(path: string, signature: string | null): Promise<FileRead> {
    return this.readStamped(readChangedCommand(path, signature), signature);
  }

  /**
   * The lines of a transcript that name any of `ids`, read again only when
   * they changed: how a subagent's screen learns its agent ended without
   * the chat underneath (see `delegationLinesCommand`).
   */
  async linesNaming(path: string, ids: readonly string[], signature: string | null): Promise<FileRead> {
    const command = delegationLinesCommand(path, ids, signature);
    if (command === null) return { kind: 'unknown', reason: 'not an id this app reads' };
    return this.readStamped(command, signature);
  }

  /** Run a command that prints a checksum line and then, if it changed, the text. */
  private async readStamped(command: string, signature: string | null): Promise<FileRead> {
    const result = await this.transport.exec(withPath(command), SUBAGENT_READ_TIMEOUT_MS);
    if (!result.ok) return { kind: 'unknown', reason: result.message };
    if (result.exitCode === ABSENT_EXIT) return { kind: 'absent' };
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim().split('\n')[0] ?? '';
      return { kind: 'unknown', reason: detail.length > 0 ? detail : `the read exited ${result.exitCode}` };
    }
    const newline = result.stdout.indexOf('\n');
    const stamp = (newline === -1 ? result.stdout : result.stdout.slice(0, newline)).trim();
    if (stamp.length === 0) return { kind: 'unknown', reason: "the host didn't say how big the file is" };
    if (stamp === signature) return { kind: 'unchanged', signature: stamp };
    return { kind: 'text', signature: stamp, text: newline === -1 ? '' : result.stdout.slice(newline + 1) };
  }
}

export type FileRead =
  | { kind: 'text'; text: string; signature: string }
  | { kind: 'unchanged'; signature: string }
  | { kind: 'absent' }
  | { kind: 'unknown'; reason: string };

/** Per transport, as `TranscriptStore` caches `$HOME`: the transport is the connection. */
const resolvedByTransport = new WeakMap<HerdrTransport, Map<string, ResolvedAgent>>();
