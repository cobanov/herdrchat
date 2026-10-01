import { POLL_TIMEOUT_MS } from '../herdr/timeouts';
import { connectingTitle, SLOW_CONNECT_MS } from '../connecting';

describe('connecting', () => {
  // The hint is only worth showing if it comes well before the poll gives up.
  it('explains a slow host well before the poll times out', () => {
    expect(SLOW_CONNECT_MS).toBeLessThanOrEqual(POLL_TIMEOUT_MS / 3);
  });

  it('names the host, or its address when it has no name', () => {
    expect(connectingTitle({ name: 'mac-studio', host: '100.64.0.2' })).toBe('Connecting to mac-studio…');
    expect(connectingTitle({ name: '  ', host: '100.64.0.2' })).toBe('Connecting to 100.64.0.2…');
  });
});
