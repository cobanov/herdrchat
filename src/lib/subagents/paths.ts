import { shellQuote } from '../herdr/shell';
import { parseAgentMeta, type AgentMeta } from './meta';

/**
 * Where Claude Code keeps a session's subagents and workflow runs, all of it
 * under the session's own folder: the transcript path without `.jsonl`.
 *
 *     <projects>/<project>/<session>.jsonl                           the session
 *     <projects>/<project>/<session>/subagents/agent-<id>.jsonl       a subagent
 *     <projects>/<project>/<session>/subagents/agent-<id>.meta.json   …its meta
 *     <projects>/<project>/<session>/workflows/<runId>.json           a workflow run
 *     <projects>/<project>/<session>/subagents/workflows/<runId>/agent-<id>.jsonl
 *
 * Measured on Claude Code 2.1.294 (2026-10). A subagent's own subagents
 * (`spawnDepth` 2) are filed flat beside it, under the same session, so the
 * folder of a subagent's transcript is never where its children live; ask
 * `sessionDir` for that.
 */

/**
 * The session folder for a transcript: the session's own, or the session a
 * subagent's or a workflow agent's transcript belongs to. Null for a path
 * that is neither.
 */
export function sessionDir(transcriptPath: string): string | null {
  const nested = transcriptPath.lastIndexOf('/subagents/');
  if (nested > 0) return transcriptPath.slice(0, nested);
  if (!transcriptPath.endsWith('.jsonl') || !transcriptPath.startsWith('/')) return null;
  const dir = transcriptPath.slice(0, -'.jsonl'.length);
  return dir.endsWith('/') ? null : dir;
}

/** A subagent's transcript. `runId` for one a workflow started. */
export function agentTranscriptPath(dir: string, agentId: string, runId: string | null = null): string {
  return `${agentsDir(dir, runId)}/agent-${agentId}.jsonl`;
}

/** A subagent's meta file, beside its transcript. */
export function agentMetaPath(dir: string, agentId: string, runId: string | null = null): string {
  return `${agentsDir(dir, runId)}/agent-${agentId}.meta.json`;
}

/** The folder holding a session's subagents, or one workflow run's. */
export function agentsDir(dir: string, runId: string | null = null): string {
  return runId === null ? `${dir}/subagents` : `${dir}/subagents/workflows/${runId}`;
}

/** A workflow run's progress file, which Claude rewrites as the run goes. */
export function workflowRunPath(dir: string, runId: string): string {
  return `${dir}/workflows/${runId}.json`;
}

/** The agent id a subagent transcript is named by, or null for any other path. */
export function agentIdFromPath(path: string): string | null {
  const match = /\/agent-([A-Za-z0-9_-]+)\.jsonl$/.exec(path);
  return match?.[1] ?? null;
}

/**
 * An id safe to put in a path or a command: Claude's agent ids are hex,
 * tool use ids `toolu_…`, run ids `wf_…-…`. Anything else is refused rather
 * than quoted, so it can never widen into a traversal.
 */
export function isInertId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

/**
 * The command that finds which subagent a `tool_use` started, by the
 * `toolUseId` in its meta, and prints that meta.
 *
 * Never "the newest agent file": two agents started in one turn are written
 * within a millisecond of each other, and guessing previews someone else's
 * work (CLAUDE.md, "Never guess a transcript file"). The meta names the call
 * that started it, so the match is exact.
 *
 * Prints, for the one match, its file name on a line and then its contents;
 * prints nothing, and exits 0, when the folder is missing or the agent has not
 * written its meta yet: the card says "starting" and asks again. `grep -F`
 * on the quoted id, so a description that mentions the id cannot match, and
 * plain `sh` with no python or jq, which a host may not have.
 *
 * `find` lists the metas rather than a glob: commands arrive in the login
 * shell, and zsh aborts the whole command on a glob that matches nothing
 * ("no matches found", exit 1) where sh hands the loop the pattern. The names
 * are Claude's, `agent-<hex>.meta.json`, so splitting the list is safe, and
 * it is split in zsh too (command substitution, unlike a variable).
 */
export function resolveAgentCommand(dir: string, toolUseId: string): string | null {
  if (!isInertId(toolUseId)) return null;
  return (
    `if cd ${shellQuote(`${dir}/subagents`)} 2>/dev/null; then ` +
    `for m in $(find . -maxdepth 1 -name 'agent-*.meta.json' 2>/dev/null); do ` +
    `if grep -q -F ${shellQuote(`"${toolUseId}"`)} "$m" 2>/dev/null; then ` +
    `printf '%s\\n' "\${m##*/}"; cat "$m"; printf '\\n'; break; fi; ` +
    'done; fi; :'
  );
}

export interface ResolvedAgent {
  agentId: string;
  meta: AgentMeta;
}

/**
 * What `resolveAgentCommand` printed: the agent and its meta, or null when
 * nothing matched yet. A meta that names a different call is refused, so a
 * stray match (the id inside a description) never opens the wrong agent.
 */
export function parseResolveOutput(stdout: string, toolUseId: string): ResolvedAgent | null {
  const newline = stdout.indexOf('\n');
  if (newline === -1) return null;
  const name = /^agent-([A-Za-z0-9_-]+)\.meta\.json$/.exec(stdout.slice(0, newline).trim());
  const agentId = name?.[1];
  if (agentId === undefined) return null;
  const meta = parseAgentMeta(stdout.slice(newline + 1));
  if (meta === null || meta.toolUseId !== toolUseId) return null;
  return { agentId, meta };
}

/**
 * The command that prints a file's checksum and size on one line and then,
 * only when that differs from `signature`, the file. Exits `ABSENT_EXIT` when
 * the file is not there yet. `cksum` is POSIX, where `stat`'s flags are not.
 */
export function readChangedCommand(path: string, signature: string | null): string {
  const quoted = shellQuote(path);
  return (
    `[ -e ${quoted} ] || exit ${ABSENT_EXIT}; s=$(cksum < ${quoted}); printf '%s\\n' "$s"; ` +
    `[ "$s" = ${shellQuote(signature ?? '')} ] || cat ${quoted}`
  );
}

/** The status `readChangedCommand` exits with for a file that does not exist yet. */
export const ABSENT_EXIT = 44;
