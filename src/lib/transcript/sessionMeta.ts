import { displayText, type ChatMessage } from './message';

/**
 * Session facts from the transcript, never the host's global model defaults.
 */
export interface SessionMeta {
  /** Raw model id, e.g. "claude-opus-4-8". */
  model: string | null;
  /** Codex turn setting. Absent on usage-only events; null means not reported. */
  effort?: string | null;
  /** Tokens currently in the context window (last request's prompt size). */
  contextTokens: number | null;
}

/**
 * Friendly model name: "claude-opus-4-8" → "Opus 4.8", "claude-fable-5" →
 * "Fable 5". Falls back to the raw id if it doesn't fit the pattern.
 */
export function modelDisplayName(model: string | null): string | null {
  if (model === null || model.length === 0) return null;
  const base = model.split('[')[0] ?? model; // drop a "[1m]" context-window suffix
  // Non-Claude model ids are already meaningful, including decimal versions.
  if (!base.startsWith('claude-')) return base;
  const noPrefix = base.startsWith('claude-') ? base.slice('claude-'.length) : base;
  const all = noPrefix.split('-').filter((token) => token.length > 0);
  // The pre-2025 form put the version first: claude-3-5-sonnet-20241022 is
  // Sonnet 3.5. Read it as family-then-version like the current ids.
  const firstWord = all.findIndex((token) => !/^\d+$/.test(token));
  const tokens =
    firstWord > 0 ? [all[firstWord] ?? '', ...all.slice(0, firstWord), ...all.slice(firstWord + 1)] : all;
  const family = tokens[0];
  if (family === undefined || family.length === 0) return model;

  const familyName = family.charAt(0).toUpperCase() + family.slice(1);
  // Version = the short numeric tokens; long date suffixes like 20251001 are not
  // part of the name a human would say.
  const version = tokens
    .slice(1)
    .filter((token) => /^\d{1,2}$/.test(token))
    .join('.');
  return version.length === 0 ? familyName : `${familyName} ${version}`;
}

/**
 * Compact context label, e.g. "ctx 33k".
 *
 * Shown as a token COUNT, not a percentage: the context window size (200K vs a
 * 1M variant) isn't recorded in the transcript, so a percentage would be a
 * confident-looking guess.
 */
export function contextLabel(contextTokens: number | null): string | null {
  if (contextTokens === null) return null;
  return contextTokens >= 1000
    ? `ctx ${Math.round(contextTokens / 1000)}k`
    : `ctx ${contextTokens}`;
}

/**
 * The model and effort a slash command has just set, read from its note
 * ("Set model to Sonnet 5.5 for this session only", "Set effort level to
 * xhigh (this session only): …"), until the agent next speaks.
 *
 * The header's model and effort come from assistant turns, so after `/model`
 * it went on naming the old model until the next reply. The command's own
 * note says what changed; once the agent has answered, its turn carries the
 * truth again and the notes before it no longer count.
 */
export function settingsFromNotes(messages: readonly ChatMessage[]): { model: string | null; effort: string | null } {
  let model: string | null = null;
  let effort: string | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.role === 'assistant') break;
    if (message.role !== 'system') continue;
    const note = displayText(message).trim();
    const named = MODEL_NOTE.exec(note) ?? KEPT_NOTE.exec(note);
    if (model === null && named !== null) model = (named[1] ?? '').replace(/\s*\(default\)$/, '').trim() || null;
    const level = EFFORT_NOTE.exec(note);
    if (effort === null && level !== null) effort = level[1] ?? null;
  }
  return { model, effort };
}

const MODEL_NOTE = /^Set model to (.+?)(?: for this session only| and saved as your default.*)?$/;
const KEPT_NOTE = /^Kept model as (.+)$/;
const EFFORT_NOTE = /^Set effort level to ([a-z]+)\b/;
