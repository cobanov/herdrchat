import { BACKOFF_CEILING_MS, backoffDelay, shouldPoll } from '../poll';

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
