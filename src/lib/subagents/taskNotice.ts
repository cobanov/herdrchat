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
    notices.push({
      toolUseId,
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
