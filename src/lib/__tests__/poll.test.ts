import { BACKOFF_CEILING_MS, backoffDelay, LIVE_POLL_MS, pollsFast, shouldPoll, STATUS_POLL_MS, statusPollMs } from '../poll';
import { decodePollScale } from '@/state/settings';

/**
 * A host that is down used to get a failing SSH round-trip every two or three
 * seconds, forever, on a metered radio. And both screens polled at once, because
 * a pushed route does not unmount what it covers.
 */

describe('backoffDelay', () => {
  it('leaves a healthy loop at its base interval', () => {
    expect(backoffDelay(3_000, 0)).toBe(3_000);
  });

  it('doubles while failures keep coming', () => {
    expect(backoffDelay(3_000, 1)).toBe(6_000);
    expect(backoffDelay(3_000, 2)).toBe(12_000);
    expect(backoffDelay(3_000, 3)).toBe(24_000);
  });

  it('stops growing at the ceiling, however long the host has been away', () => {
    // Without a cap, a host down overnight would come back to a poll scheduled
    // days out — the user would have to force-quit to see it return.
    expect(backoffDelay(3_000, 40)).toBe(BACKOFF_CEILING_MS);
    expect(backoffDelay(3_000, 400)).toBe(BACKOFF_CEILING_MS);
  });

  it('is never NaN or negative for a nonsense failure count', () => {
    expect(backoffDelay(3_000, -1)).toBe(3_000);
  });
});

describe('shouldPoll', () => {
  it('polls only when the app is foreground AND this screen is on top', () => {
    expect(shouldPoll({ active: true, focused: true })).toBe(true);
    expect(shouldPoll({ active: false, focused: true })).toBe(false);
    // The chat list sits mounted underneath an open conversation. The thread's
    // own poll covers what the user is actually reading.
    expect(shouldPoll({ active: true, focused: false })).toBe(false);
    expect(shouldPoll({ active: false, focused: false })).toBe(false);
  });
});

/**
 * The stored value is a string from SQLite and could be anything — a row
 * written by an older build, a hand-edited database, a partial write. A poll
 * interval of NaN or zero would spin the loop, so parsing clamps rather than
 * trusts.
 */
describe('decodePollScale', () => {
  it('accepts the values the picker offers', () => {
    expect(decodePollScale('1')).toBe(1);
    expect(decodePollScale('2')).toBe(2);
    expect(decodePollScale('5')).toBe(5);
  });

  it('falls back rather than let a bad row set the interval', () => {
    expect(decodePollScale(null)).toBe(1);
    expect(decodePollScale('')).toBe(1);
    expect(decodePollScale('0')).toBe(1);
    expect(decodePollScale('-3')).toBe(1);
    expect(decodePollScale('banana')).toBe(1);
    expect(decodePollScale('999')).toBe(1);
  });
});

// With the host's events live the thread polls every 30 s, except while
// something on screen changes with no event to say so.
describe('the thread poll\'s pace', () => {
  const quiet = { working: false, blocked: false, watchingPanel: false, agentsRunning: false };

  it('is slow only when nothing calls for the fast rate', () => {
    expect(pollsFast(quiet)).toBe(false);
    expect(pollsFast({ ...quiet, working: true })).toBe(true);
    expect(pollsFast({ ...quiet, blocked: true })).toBe(true);
    expect(pollsFast({ ...quiet, watchingPanel: true })).toBe(true);
  });

  it('stays fast while Claude idles over background agents that still run', () => {
    // herdr says idle; only the agents pane says otherwise. At 30 s the bar
    // said "working" half a minute after the last agent finished.
    expect(pollsFast({ ...quiet, agentsRunning: true })).toBe(true);
    expect(statusPollMs({ streamLive: true, fast: pollsFast({ ...quiet, agentsRunning: true }), pollScale: 1 })).toBe(STATUS_POLL_MS);
  });

  it('slows to the live rate once every agent is done', () => {
    expect(statusPollMs({ streamLive: true, fast: pollsFast(quiet), pollScale: 1 })).toBe(LIVE_POLL_MS);
  });

  it('stays at the fast rate, scaled, without the event stream', () => {
    expect(statusPollMs({ streamLive: false, fast: false, pollScale: 1 })).toBe(STATUS_POLL_MS);
    expect(statusPollMs({ streamLive: false, fast: false, pollScale: 5 })).toBe(STATUS_POLL_MS * 5);
    expect(statusPollMs({ streamLive: true, fast: true, pollScale: 2 })).toBe(STATUS_POLL_MS * 2);
  });
});
