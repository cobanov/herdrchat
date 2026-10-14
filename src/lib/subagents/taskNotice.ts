import type { TaskNotice } from '../transcript/message';

/**
 * The `<task-notification>` blocks in a turn's text.
 *
 * A background subagent's `tool_result` comes back at once and says only
 * "Async agent launched successfully … agentId: …"; a workflow's says
 * "Workflow launched in background … Run ID: …". The end arrives later, as a
 * user turn Claude writes for itself (Claude Code 2.1.273-2.1.294):
 *
 *     <task-notification>
 *     <task-id>a53e546bf8054816f</task-id>
 *     <tool-use-id>toolu_01YHaw6KgVXRztcfnALFWkii</tool-use-id>
 *     <output-file>…</output-file>
 *     <status>completed</status>
 *     <summary>Agent "Catalog API, auth, streams, signing" finished</summary>
 *     <result>…</result>
 *     <usage><subagent_tokens>153883</subagent_tokens><tool_uses>29</tool_uses><duration_ms>249552</duration_ms></usage>
 *     </task-notification>
 *
 * Read as a launch result alone, every background agent would show "done"
 * the moment it started. One turn can carry several, and a notification
 * without a tool-use id (a cron fire, a peer message) is not one of these.
 */
export function parseTaskNotices(text: string): TaskNotice[] {
  if (!text.includes('<task-notification>')) return [];
  const notices: TaskNotice[] = [];
  for (const [, body = ''] of text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
    const toolUseId = element(body, 'tool-use-id')?.trim();
    const status = element(body, 'status')?.trim();
    if (toolUseId === undefined || toolUseId.length === 0 || status === undefined || status.length === 0) continue;
    const result = element(body, 'result')?.trim();
    const summary = element(body, 'summary')?.trim();
    const taskId = element(body, 'task-id')?.trim();
    notices.push({
      toolUseId,
      taskId: taskId === undefined || taskId.length === 0 ? null : taskId,
      status,
      summary: summary === undefined || summary.length === 0 ? null : summary,
      result: result === undefined || result.length === 0 ? null : result,
      tokens: count(element(body, 'subagent_tokens') ?? element(body, 'total_tokens')),
      toolUses: count(element(body, 'tool_uses')),
      durationMs: count(element(body, 'duration_ms')),
    });
  }
  return notices;
}

/** A notification's status that means the task did not finish its work. */
export function isFailedStatus(status: string): boolean {
  return status === 'failed' || status === 'killed' || status === 'error' || status === 'cancelled';
}

function element(text: string, tag: string): string | undefined {
  return new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1];
}

function count(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * A background subagent's report, as Claude Code 2.1.294 hands it back: a
 * turn of its own from the agent, recorded both as a `user` line and as a
 * queued attachment, with the agent in `origin`:
 *
 *     origin: {kind: "peer", from: "<agentId>", handback: true,
 *              body: "[Subagent hand-back] …The report follows:\n  <report, indented two spaces>"}
 *
 * and in the text as `<agent-message from="<agentId>">…</agent-message>`.
 * The task notification that ends the agent then says only "This agent's
 * report was delivered to you as a message from …", so without this every
 * background agent's card folded open onto that pointer instead of its work.
 * Null for any other turn, a peer's plain message included.
 */
export function parseHandback(origin: unknown, text: string | null): { agentId: string; report: string } | null {
  const fields = typeof origin === 'object' && origin !== null ? (origin as Record<string, unknown>) : null;
  if (fields !== null && fields.kind === 'peer' && fields.handback === true && typeof fields.from === 'string' && typeof fields.body === 'string') {
    return handback(fields.from, fields.body);
  }
  if (text === null || !text.includes('<agent-message')) return null;
  const match = /<agent-message from="([A-Za-z0-9_-]+)">\n?([\s\S]*?)<\/agent-message>/.exec(text);
  if (match === null || !(match[2] ?? '').includes(HANDBACK_MARK)) return null;
  return handback(match[1] ?? '', match[2] ?? '');
}

/**
 * The agent a notification's result points to when the report went out as a
 * hand-back instead: `…delivered to you as a message from "<agentId>"…`.
 */
export function handbackPointer(result: string | null): string | null {
  if (result === null) return null;
  return /delivered to you as a message from "([A-Za-z0-9_-]+)"/.exec(result)?.[1] ?? null;
}

const HANDBACK_MARK = '[Subagent hand-back]';

/** The report under the frame, with the two spaces the harness indents it by taken off. */
function handback(agentId: string, body: string): { agentId: string; report: string } | null {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(agentId) || !body.includes(HANDBACK_MARK)) return null;
  const follows = /The report follows:[^\n]*\n/.exec(body);
  const rest = follows === null ? body.slice(body.indexOf(HANDBACK_MARK) + HANDBACK_MARK.length) : body.slice(follows.index + follows[0].length);
  const report = rest.split('\n').map((line) => (line.startsWith('  ') ? line.slice(2) : line)).join('\n').trim();
  return report.length === 0 ? null : { agentId, report };
}
