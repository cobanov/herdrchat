/**
 * When to welcome someone, and when to ask for a star.
 *
 * The welcome is for a person who has not set anything up: shown once, on a
 * first launch with no host of their own. Someone updating with hosts saved
 * already knows the app and never sees it.
 *
 * The star is asked for once, politely, and only of someone who has come back
 * to a real host on a few different days: asking a first-time user to endorse
 * an app they have not used yet is asking for nothing.
 */

export const REPO_URL = 'https://github.com/cobanov/herdrchat';
export const SETUP_GUIDE_URL = `${REPO_URL}/blob/main/docs/getting-started.md`;

/** Days of use on a real host before the one-time star card shows. */
export const STAR_AFTER_DAYS = 3;

export function shouldShowWelcome(state: { hydrated: boolean; welcomeSeen: boolean; hostCount: number }): boolean {
  return state.hydrated && !state.welcomeSeen && state.hostCount === 0;
}

/** Distinct days the app was used on a real host, stored as "count|YYYY-MM-DD". */
export interface ActiveDays {
  count: number;
  last: string | null;
}

export function decodeActiveDays(value: string | null): ActiveDays {
  const match = /^(\d+)\|(\d{4}-\d{2}-\d{2})$/.exec(value ?? '');
  return match === null ? { count: 0, last: null } : { count: Number(match[1]), last: match[2] ?? null };
}

export function encodeActiveDays(days: ActiveDays): string {
  return `${days.count}|${days.last ?? ''}`;
}

/** Count today, once. `today` is the local calendar date, "YYYY-MM-DD". */
export function recordActiveDay(days: ActiveDays, today: string): ActiveDays {
  return days.last === today ? days : { count: days.count + 1, last: today };
}

export function shouldAskForStar(state: { days: ActiveDays; starAsked: boolean; onRealHost: boolean }): boolean {
  return state.onRealHost && !state.starAsked && state.days.count >= STAR_AFTER_DAYS;
}

/** The local calendar date as "YYYY-MM-DD". */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
