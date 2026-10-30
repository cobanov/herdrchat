import { resetLabel, type PlanUsage, type UsageWindow } from './planUsage';

/**
 * The chat list's usage footer, as data: one row per window still in force,
 * the five hours first (the one a working session moves) and the week below
 * it, and whether the capture is old enough to say when it was taken.
 *
 * Pure, and given `now`, so the footer re-renders the same rows as time
 * passes and a window whose reset has gone by drops out without a new read:
 * the file may be hours old when the app reads it, and a window past its
 * reset says nothing true any more.
 */
export interface UsageRow {
  key: 'week' | '5h';
  title: string;
  percentLeft: number;
  /** The share shown, and the bar's fill: what is left, or what is used, as the person chose. */
  percent: number;
  /** "62% left" or "38% used". */
  amount: string;
  /** "Thu 9:00 AM", or the time alone within a day. */
  reset: string;
  /** What VoiceOver and TalkBack read for the row. */
  spoken: string;
}

/**
 * Which share a row shows: what is left of a limit, or how much of it is
 * used so far. Claude Code's own `/usage` counts up; a budget counts down.
 * People read it both ways, so it is theirs to pick.
 */
export type UsageShown = 'left' | 'used';

export function usageRows(
  usage: PlanUsage,
  now: number,
  shown: UsageShown = 'left',
  locale?: string,
  timeZone?: string
): UsageRow[] {
  const rows: UsageRow[] = [];
  const add = (key: UsageRow['key'], title: string, spokenName: string, window: UsageWindow | null) => {
    if (window === null || window.resetsAt <= now) return;
    const percent = shown === 'left' ? window.percentLeft : 100 - window.percentLeft;
    rows.push({
      key,
      title,
      percentLeft: window.percentLeft,
      percent,
      amount: `${percent}% ${shown}`,
      reset: resetLabel(window.resetsAt, now, locale, timeZone),
      spoken: `${spokenName}, ${percent} percent ${shown}, resets ${spokenReset(window.resetsAt, now, locale, timeZone)}`,
    });
  };
  add('5h', '5h', 'Five-hour limit', usage.fiveHour);
  add('week', 'Week', 'Weekly limit', usage.sevenDay);
  return rows;
}

/** The reset as it is read aloud: the weekday in full ("Thursday 9:00 AM"), where the label abbreviates it. */
function spokenReset(resetsAt: number, now: number, locale?: string, timeZone?: string): string {
  const at = new Date(resetsAt * 1000);
  const time = at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone });
  if (resetsAt - now < DAY_SECONDS) return time;
  return `${at.toLocaleDateString(locale, { weekday: 'long', timeZone })} ${time}`;
}

const DAY_SECONDS = 24 * 60 * 60;

/**
 * "as of 2:14 PM" when the capture is older than `staleAfterSeconds`, null
 * otherwise. Claude saves the file only while a session's status line
 * redraws, so a quiet host shows numbers from its last session; saying when
 * keeps them from passing for live ones.
 */
export function capturedNote(
  capturedAt: number,
  now: number,
  staleAfterSeconds: number,
  locale?: string,
  timeZone?: string
): string | null {
  if (now - capturedAt <= staleAfterSeconds) return null;
  const time = new Date(capturedAt * 1000).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone });
  if (now - capturedAt < DAY_SECONDS) return `as of ${time}`;
  return `as of ${new Date(capturedAt * 1000).toLocaleDateString(locale, { weekday: 'short', timeZone })} ${time}`;
}
