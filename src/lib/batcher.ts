/**
 * Items collected for `delayMs`, then handed to `flush` together, one flush
 * at a time and in order. `drain` flushes what is waiting now.
 *
 * `failure` holds the first error a flush threw, so a caller that feeds the
 * batcher from a loop can stop on it as it would have stopped on an await.
 */
export interface Batcher<T> {
  push(item: T): void;
  drain(): Promise<void>;
  readonly failure: unknown;
}

export function batcher<T>(flush: (items: T[]) => Promise<void>, delayMs: number): Batcher<T> {
  let pending: T[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let failure: unknown = undefined;
  const run = (): Promise<void> => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const items = pending;
    pending = [];
    if (items.length > 0) {
      chain = chain.then(async () => {
        if (failure !== undefined) return;
        try {
          await flush(items);
        } catch (thrown) {
          failure = thrown;
        }
      });
    }
    return chain;
  };
  return {
    push(item) {
      pending.push(item);
      timer ??= setTimeout(() => void run(), delayMs);
    },
    drain: run,
    get failure() {
      return failure;
    },
  };
}
