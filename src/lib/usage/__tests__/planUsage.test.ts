import { parseUsageFile, resetLabel } from '../planUsage';

// 2026-10-24 17:00 UTC, a Saturday.
const now = 1792861200;
const hour = 3600;

const file = (rateLimits: unknown, capturedAt = now - 60) =>
  JSON.stringify({ captured_at: capturedAt, status: { session_id: 's1', rate_limits: rateLimits } });

it('reads both windows as percent left and when each resets', () => {
  const usage = parseUsageFile(file({
    five_hour: { used_percentage: 20, resets_at: now + 2 * hour },
    seven_day: { used_percentage: 38.4, resets_at: now + 120 * hour },
  }), now);
  expect(usage).toEqual({
    fiveHour: { percentLeft: 80, resetsAt: now + 2 * hour },
    sevenDay: { percentLeft: 62, resetsAt: now + 120 * hour },
    capturedAt: now - 60,
  });
});

// Claude reports above 100 once a limit is exceeded.
it('never says less than none left', () => {
  const usage = parseUsageFile(file({ seven_day: { used_percentage: 112, resets_at: now + hour } }), now);
  expect(usage?.sevenDay?.percentLeft).toBe(0);
  expect(usage?.fiveHour).toBeNull();
});

// The file can outlive a reset: what it said about that window is no longer true.
it('drops a window whose reset has passed, and says nothing when none is left', () => {
  const limits = { five_hour: { used_percentage: 90, resets_at: now - 1 }, seven_day: { used_percentage: 40, resets_at: now + hour } };
  expect(parseUsageFile(file(limits), now)?.fiveHour).toBeNull();
  expect(parseUsageFile(file(limits), now + 2 * hour)).toBeNull();
});

it('shows nothing for an API-key session, a missing field or a file it cannot read', () => {
  expect(parseUsageFile(JSON.stringify({ captured_at: now, status: { session_id: 's1' } }), now)).toBeNull();
  expect(parseUsageFile(file({ seven_day: { resets_at: now + hour } }), now)).toBeNull();
  expect(parseUsageFile(JSON.stringify({ status: { rate_limits: {} } }), now)).toBeNull();
  expect(parseUsageFile('', now)).toBeNull();
  expect(parseUsageFile('not json', now)).toBeNull();
});

it('says the time within a day and the weekday beyond', () => {
  expect(resetLabel(now + 100 * 60, now, 'en-US', 'UTC')).toBe('6:40 PM');
  expect(resetLabel(now + 112 * hour, now, 'en-US', 'UTC')).toBe('Thu 9:00 AM');
});
