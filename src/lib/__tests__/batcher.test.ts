import { batcher } from '../batcher';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('hands a burst over in one flush, in order, after the delay', async () => {
  const flushed: number[][] = [];
  const batch = batcher<number>(async (items) => { flushed.push(items); }, 100);
  batch.push(1);
  batch.push(2);
  await jest.advanceTimersByTimeAsync(50);
  batch.push(3);
  expect(flushed).toEqual([]);
  await jest.advanceTimersByTimeAsync(60);
  expect(flushed).toEqual([[1, 2, 3]]);
  batch.push(4);
  await batch.drain();
  expect(flushed).toEqual([[1, 2, 3], [4]]);
});

it('runs one flush at a time, and stops after the first that fails', async () => {
  const order: string[] = [];
  let release: () => void = () => undefined;
  const batch = batcher<string>(async (items) => {
    order.push(`start ${items.join()}`);
    if (items[0] === 'a') await new Promise<void>((resolve) => { release = resolve; });
    if (items[0] === 'b') throw new Error('disk full');
    order.push(`end ${items.join()}`);
  }, 10);
  batch.push('a');
  void batch.drain();
  batch.push('b');
  void batch.drain();
  batch.push('c');
  const last = batch.drain();
  await Promise.resolve();
  expect(order).toEqual(['start a']);
  release();
  await last;
  expect(order).toEqual(['start a', 'end a', 'start b']);
  expect((batch.failure as Error).message).toBe('disk full');
});
