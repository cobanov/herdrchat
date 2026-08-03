/**
 * Lightweight session facts for the chat header: which Claude model is answering
 * and how full the context window is. Sourced from the newest assistant turn in
 * the transcript.
 */
export interface SessionMeta {
  /** Raw model id, e.g. "claude-opus-4-8". */
  model: string | null;
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
  const noPrefix = base.startsWith('claude-') ? base.slice('claude-'.length) : base;
  const tokens = noPrefix.split('-').filter((token) => token.length > 0);
  const family = tokens[0];
  if (family === undefined) return model;

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
