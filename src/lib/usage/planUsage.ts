/**
 * Claude's plan usage on a host, as its status line last saw it.
 *
 * Claude Code hands its status line command a JSON object that carries
 * `rate_limits`: a `five_hour` and a `seven_day` window, each with
 * `used_percentage` (0–100, above 100 once exceeded) and `resets_at` (Unix
 * seconds). It writes them nowhere else, so the wrapper HerdrChat installs as
 * the status line (`statusLineWrap.ts`) saves that object to
 * `~/.cache/herdrchat/usage.json` as `{ captured_at, status }`, and this reads it.
 *
 * Claude drops a window from the object once its reset has passed, and
 * leaves out `rate_limits` altogether for anyone not on a Claude plan.
 * A saved file can be older than a reset, so a window past its
 * reset is dropped here too: what it said is no longer true.
 */

export const USAGE_FILE = '.cache/herdrchat/usage.json';

export interface UsageWindow {
  /** Whole percent of the window left, 0–100. */
  percentLeft: number;
  /** When the window resets, Unix seconds. */
  resetsAt: number;
}

export interface PlanUsage {
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  /** When the status line last saw them, Unix seconds. */
  capturedAt: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function usageWindow(value: unknown, now: number): UsageWindow | null {
  const window = record(value);
  const used = finite(window?.used_percentage);
  const resetsAt = finite(window?.resets_at);
  if (used === null || resetsAt === null || resetsAt <= now) return null;
  return { percentLeft: Math.round(Math.min(100, Math.max(0, 100 - used))), resetsAt };
}

/**
 * The usage file's windows still in force at `now` (Unix seconds), or null
 * when there is nothing to show: no file yet, a file this does not read, or
 * no plan windows (an API-key session saved the last status line).
 */
export function parseUsageFile(text: string, now: number): PlanUsage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const file = record(parsed);
  const capturedAt = finite(file?.captured_at);
  const limits = record(record(file?.status)?.rate_limits);
  if (capturedAt === null || limits === null) return null;
  const usage = { fiveHour: usageWindow(limits.five_hour, now), sevenDay: usageWindow(limits.seven_day, now), capturedAt };
  return usage.fiveHour === null && usage.sevenDay === null ? null : usage;
}

/**
 * When a window resets, as the sidebar says it: the time alone when it is
 * within a day ("6:40 PM"), the weekday and time when further ("Thu 9:00 AM").
 */
export function resetLabel(resetsAt: number, now: number, locale?: string, timeZone?: string): string {
  const at = new Date(resetsAt * 1000);
  const time: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone };
  if (resetsAt - now < DAY_SECONDS) return at.toLocaleTimeString(locale, time);
  return at.toLocaleString(locale, { weekday: 'short', ...time });
}

const DAY_SECONDS = 24 * 60 * 60;
