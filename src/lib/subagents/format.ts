/**
 * How a subagent's or a workflow's figures read on its card and its rows:
 * "1m 6s", "21.5k tokens", "6 tool calls". Null for a figure the files did
 * not give, so a caption leaves it out rather than saying "0s".
 */

/** "48s", "1m 6s", "1h 2m". Under a second reads "<1s"; a negative or unknown duration, null. */
export function formatDuration(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1_000) return '<1s';
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
}

/** "940 tokens", "21.5k tokens", "1.2M tokens". */
export function formatTokens(tokens: number | null): string | null {
  if (tokens === null || !Number.isFinite(tokens) || tokens < 0) return null;
  if (tokens < 1_000) return `${Math.round(tokens)} ${tokens === 1 ? 'token' : 'tokens'}`;
  if (tokens < 1_000_000) return `${trim(tokens / 1_000)}k tokens`;
  return `${trim(tokens / 1_000_000)}M tokens`;
}

/** "1 tool call", "6 tool calls". */
export function formatToolCalls(count: number | null): string | null {
  if (count === null || !Number.isFinite(count) || count < 0) return null;
  return `${count} ${count === 1 ? 'tool call' : 'tool calls'}`;
}

/** One decimal, none when it is zero: 21.5, 17, not 17.0. A value that rounds up to the next unit keeps the decimal it rounded to. */
function trim(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
