import { useEffect, useRef } from 'react';

import type { HerdrClient } from '@/lib/herdr/client';

/**
 * Tell the host that this pane is being driven from a phone, and on what model.
 *
 * The desktop sidebar can render `$token` values (`ui.sidebar.agents.rows`), and
 * until now nothing put anything there. Someone sitting at the machine could not
 * tell an agent being steered from a phone from one that had been left alone.
 *
 * ONE REPORT PER INTERVAL, NOT PER POLL. The thread already polls every couple of
 * seconds, and attaching this to that loop would add a command every tick for a
 * label that changes almost never. The TTL is longer than the interval so the
 * label never blinks out between refreshes, and short enough that putting the
 * phone down clears it within a minute rather than leaving the desktop with a
 * stale claim that a chat is live.
 */
const REPORT_INTERVAL_MS = 20_000;
const REPORT_TTL_MS = 45_000;

/** Namespaced, so herdr can tell our metadata from another reporter's. */
const SOURCE = 'herdrchat';

export function useReportPresence(
  client: HerdrClient | null,
  paneId: string | null,
  model: string | null,
  /** False while nobody is looking at this screen — see `usePollGate`. */
  active: boolean
): void {
  /**
   * Monotonic, so two reports that cross in flight land in the order they were
   * sent. A ref rather than state: nothing renders from it.
   */
  const seq = useRef(0);

  useEffect(() => {
    if (client === null || paneId === null || !active) return;

    let cancelled = false;
    const report = () => {
      if (cancelled) return;
      seq.current += 1;
      void client.reportMetadata(paneId, {
        source: SOURCE,
        tokens: {
          phone: 'on',
          // Omitted rather than sent empty: a blank token renders as an empty
          // column in the sidebar, which reads as broken rather than as "not
          // known yet".
          ...(model === null ? {} : { model }),
        },
        ttlMs: REPORT_TTL_MS,
        seq: seq.current,
      });
    };

    report();
    const timer = setInterval(report, REPORT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client, paneId, model, active]);
}
