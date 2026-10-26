import { useSyncExternalStore } from 'react';

/**
 * The time now, re-read every `intervalMs` while anything is listening: one
 * shared timer per interval, however many rows tick on it, and none at all
 * once the last of them unmounts.
 */
export function useClock(intervalMs: number): number {
  const ticker = tickerFor(intervalMs);
  return useSyncExternalStore(ticker.subscribe, ticker.now);
}

interface Ticker {
  subscribe: (listener: () => void) => () => void;
  now: () => number;
}

const tickers = new Map<number, Ticker>();

function tickerFor(intervalMs: number): Ticker {
  const existing = tickers.get(intervalMs);
  if (existing !== undefined) return existing;
  const listeners = new Set<() => void>();
  let current = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;
  const ticker: Ticker = {
    subscribe: (listener) => {
      listeners.add(listener);
      if (timer === null) {
        current = Date.now();
        timer = setInterval(() => {
          current = Date.now();
          for (const each of listeners) each();
        }, intervalMs);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    now: () => current,
  };
  tickers.set(intervalMs, ticker);
  return ticker;
}
