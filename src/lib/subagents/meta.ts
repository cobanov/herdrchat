/**
 * A subagent's `agent-<id>.meta.json`, which Claude writes beside its
 * transcript when the agent starts. Two shapes, as measured (2.1.294):
 *
 *     {"agentType":"general-purpose","description":"Fix play key launching Music",
 *      "toolUseId":"toolu_01JBU6JVEfRNvjE9SADCDZDv","spawnDepth":1,
 *      "requestShape":"background","requestNonInteractive":true,"model":"opus"}
 *
 *     {"agentType":"workflow-subagent","description":"review:keychain-safe-write",
 *      "workflowPhase":"Review","spawnDepth":1,"requestShape":"foreground",…}
 *
 * The first is a plain subagent, linked to the `tool_use` that started it by
 * `toolUseId`. The second belongs to a workflow and names no call. Every field
 * is optional here: a missing one is shown as unknown, never guessed.
 */
export interface AgentMeta {
  agentType: string | null;
  description: string | null;
  toolUseId: string | null;
  /** 1 for the main agent's own subagents, 2 for theirs. */
  spawnDepth: number | null;
  /** `opus`, `sonnet`, or a full model id. */
  model: string | null;
  /** `background` or `foreground`. */
  requestShape: string | null;
  /** The phase title, for a workflow's agent. */
  workflowPhase: string | null;
}

/** Parse a meta file's text. Null when it is not a JSON object (missing, or half written). */
export function parseAgentMeta(text: string): AgentMeta | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const string = (key: string) => {
    const value = raw[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  const depth = raw.spawnDepth;
  return {
    agentType: string('agentType'),
    description: string('description'),
    toolUseId: string('toolUseId'),
    spawnDepth: typeof depth === 'number' && Number.isFinite(depth) ? depth : null,
    model: string('model'),
    requestShape: string('requestShape'),
    workflowPhase: string('workflowPhase'),
  };
}
