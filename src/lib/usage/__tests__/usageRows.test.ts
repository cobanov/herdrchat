import type { PlanUsage } from '../planUsage';
import { capturedNote, usageRows } from '../usageRows';

// Thursday 2026-10-22 18:00 UTC.
const now = Date.UTC(2026, 9, 22, 18, 0) / 1000;
const hour = 60 * 60;
const usage: PlanUsage = {
  capturedAt: now - 60,
  fiveHour: { percentLeft: 80, resetsAt: now + 40 * 60 },
  sevenDay: { percentLeft: 62, resetsAt: Date.UTC(2026, 9, 29, 9, 0) / 1000 },
};

it('lists the five hours first, then the week, with what each says aloud', () => {
  expect(usageRows(usage, now, 'left', 'en-US', 'UTC')).toEqual([
    { key: '5h', title: '5h', percentLeft: 80, percent: 80, amount: '80% left', reset: '6:40 PM', spoken: 'Five-hour limit, 80 percent left, resets 6:40 PM' },
    { key: 'week', title: 'Week', percentLeft: 62, percent: 62, amount: '62% left', reset: 'Thu 9:00 AM', spoken: 'Weekly limit, 62 percent left, resets Thursday 9:00 AM' },
  ]);
});

// Some read a limit as a budget, some as a meter, as Claude Code's /usage does.
it('shows how much is used instead, when the person picks that', () => {
  const rows = usageRows(usage, now, 'used', 'en-US', 'UTC');
  expect(rows.map((row) => [row.amount, row.percent, row.percentLeft])).toEqual([['20% used', 20, 80], ['38% used', 38, 62]]);
  expect(rows[1]?.spoken).toBe('Weekly limit, 38 percent used, resets Thursday 9:00 AM');
});

// The file can be older than a reset: the footer drops the window then,
// without waiting for a new read.
it('drops a window once its reset has passed', () => {
  expect(usageRows(usage, now + hour, 'left', 'en-US', 'UTC').map((row) => row.key)).toEqual(['week']);
  expect(usageRows({ ...usage, sevenDay: null }, now, 'left', 'en-US', 'UTC').map((row) => row.key)).toEqual(['5h']);
});

it('says when the numbers are from only once they are older than the threshold', () => {
  const stale = 10 * 60;
  expect(capturedNote(now - stale, now, stale, 'en-US', 'UTC')).toBeNull();
  expect(capturedNote(now - stale - 1, now, stale, 'en-US', 'UTC')).toBe('as of 5:49 PM');
  expect(capturedNote(now - 30 * hour, now, stale, 'en-US', 'UTC')).toBe('as of Wed 12:00 PM');
});
