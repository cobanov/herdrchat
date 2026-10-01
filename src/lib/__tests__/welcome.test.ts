import {
  decodeActiveDays,
  encodeActiveDays,
  localDay,
  recordActiveDay,
  shouldAskForStar,
  shouldShowWelcome,
  STAR_AFTER_DAYS,
} from '../welcome';

describe('the welcome', () => {
  it('is for a first launch with nothing set up', () => {
    expect(shouldShowWelcome({ hydrated: true, welcomeSeen: false, hostCount: 0 })).toBe(true);
  });

  it('waits for the saved state, and never shows twice or to someone with a host', () => {
    expect(shouldShowWelcome({ hydrated: false, welcomeSeen: false, hostCount: 0 })).toBe(false);
    expect(shouldShowWelcome({ hydrated: true, welcomeSeen: true, hostCount: 0 })).toBe(false);
    expect(shouldShowWelcome({ hydrated: true, welcomeSeen: false, hostCount: 1 })).toBe(false);
  });
});

describe('the star request', () => {
  it('counts each day once', () => {
    let days = decodeActiveDays(null);
    days = recordActiveDay(days, '2026-10-01');
    days = recordActiveDay(days, '2026-10-01');
    days = recordActiveDay(days, '2026-10-03');
    expect(days).toEqual({ count: 2, last: '2026-10-03' });
    expect(decodeActiveDays(encodeActiveDays(days))).toEqual(days);
    expect(decodeActiveDays('garbage')).toEqual({ count: 0, last: null });
  });

  it('asks once, after a few days on a real host', () => {
    const days = { count: STAR_AFTER_DAYS, last: '2026-10-03' };
    expect(shouldAskForStar({ days, starAsked: false, onRealHost: true })).toBe(true);
    expect(shouldAskForStar({ days, starAsked: true, onRealHost: true })).toBe(false);
    expect(shouldAskForStar({ days, starAsked: false, onRealHost: false })).toBe(false);
    expect(shouldAskForStar({ days: { count: STAR_AFTER_DAYS - 1, last: null }, starAsked: false, onRealHost: true })).toBe(false);
  });

  it('reads the local calendar date', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
