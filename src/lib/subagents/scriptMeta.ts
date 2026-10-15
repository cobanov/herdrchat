/**
 * A workflow's name and description from the `Workflow` call itself, for the
 * moment before its run file exists.
 *
 * A script opens with a meta block:
 *
 *     export const meta = {
 *       name: 'herdrchat-multi-agent',
 *       description: 'Implement per-agent chats inside a herdr workspace, then review and fix',
 *       phases: [...],
 *     }
 *
 * Read with a tolerant pattern, not evaluated: the script is someone's code
 * and the call's input reaches the app flattened and cut at a couple of
 * thousand characters. A call that re-runs a saved script names only its
 * `scriptPath`, `…/scripts/<name>-wf_<run>.js`, and the name comes from that.
 */
export interface ScriptMeta {
  name: string | null;
  description: string | null;
}

export function scriptMeta(script: string | null): ScriptMeta {
  if (script === null) return { name: null, description: null };
  const block = /\bmeta\s*=\s*\{/.exec(script);
  const scope = block === null ? script : script.slice(block.index);
  const name = literal(scope, 'name') ?? savedScriptName(script);
  return { name, description: literal(scope, 'description') };
}

/** What the card calls a workflow it knows nothing else about. */
export const WORKFLOW_FALLBACK_NAME = 'Workflow';

/** The first `key: '…'` (or "…", or `…`) string literal in `text`. */
function literal(text: string, key: string): string | null {
  const match = new RegExp(`(?:^|[\\s{,])${key}\\s*:\\s*(['"\`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`).exec(text);
  const value = match?.[2]?.replace(/\\(.)/g, '$1').trim();
  return value === undefined || value.length === 0 ? null : value;
}

/** `…/workflows/scripts/herdrchat-host-theme-wf_57d05f0f-9f9.js` → `herdrchat-host-theme`. */
function savedScriptName(text: string): string | null {
  const match = /scriptPath: \S*\/([A-Za-z0-9_.-]+?)(?:-wf_[A-Za-z0-9_-]+)?\.(?:m?js|ts)\b/.exec(text);
  return match?.[1] ?? null;
}
