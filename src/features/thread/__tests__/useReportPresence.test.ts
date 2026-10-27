import { act, renderHook } from '@testing-library/react-native';

import type { HerdrClient } from '@/lib/herdr/client';
import { useReportPresence } from '../useReportPresence';

/** The `seq` of every report, in order. */
function reporter() {
  const seqs: number[] = [];
  const client = {
    reportMetadata: (_pane: string, options: { seq: number }) => {
      seqs.push(options.seq);
      return Promise.resolve();
    },
  } as unknown as HerdrClient;
  return { client, seqs };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

// herdr ignores a report whose seq is not above the last one it accepted from
// this source for this pane, even after the TTL. A chat opened again must
// carry on above where the last open stopped, not start from 1.
test('a chat opened again reports above the seq its last open reached', async () => {
  const { client, seqs } = reporter();
  const first = await renderHook(() => useReportPresence(client, 'w1:p1', 'opus', true));
  await act(async () => { await jest.advanceTimersByTimeAsync(20_000 * 5); });
  await first.unmount();
  const lastOpen = seqs[seqs.length - 1] ?? 0;
  await act(async () => { await jest.advanceTimersByTimeAsync(1_000); });

  await renderHook(() => useReportPresence(client, 'w1:p1', 'opus', true));
  expect(seqs.length).toBe(7);
  expect(seqs[6]).toBeGreaterThan(lastOpen);
  for (let i = 1; i < seqs.length; i += 1) expect(seqs[i]).toBeGreaterThan(seqs[i - 1] ?? 0);
});
