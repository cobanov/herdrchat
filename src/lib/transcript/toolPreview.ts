/** How much of a tool's input the chip may carry. A chip shows one line anyway. */
const TOOL_INPUT_PREVIEW_CHARS = 2_000;

/**
 * How much of a tool's result is kept. The thread shows a few lines of it
 * under an opened call; the rest (a whole file read, a test log) stays on
 * the host rather than in every cached row.
 */
const TOOL_RESULT_PREVIEW_CHARS = 4_000;

export function capped(text: string): string {
  return text.length <= TOOL_RESULT_PREVIEW_CHARS ? text : `${text.slice(0, TOOL_RESULT_PREVIEW_CHARS)}…`;
}

/**
 * A short single-line preview of a tool's input, for the tool chip.
 *
 * Capped, because "short" was only ever true of the tools that take short
 * arguments: a Write of a 200 KB file put the whole body here, and every one of
 * those went into SQLite and back out again on each thread open.
 */
export function compactJson(value: unknown): string | null {
  const flat = flattenJson(value);
  if (flat === null || flat.length <= TOOL_INPUT_PREVIEW_CHARS) return flat;
  return `${flat.slice(0, TOOL_INPUT_PREVIEW_CHARS)}…`;
}

function flattenJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => flattenJson(item) ?? 'null').join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => `${key}: ${flattenJson(item) ?? 'null'}`
    );
    return `{${entries.join(', ')}}`;
  }
  return null;
}
