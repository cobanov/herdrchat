import { useEffect, useRef, useState } from 'react';

import { EventFeed, type HostEvent } from '../lib/herdr/events';
import type { HerdrClient } from '../lib/herdr/client';

/**
 * Hold one `events.subscribe` stream open for these panes and hand each event
 * to `onEvent`. Returns whether the stream is live right now, which the poll
 * loops read to decide how often they still need to ask.
 *
 * `onEvent` goes through a ref so a new callback identity does not tear the
 * connection down; only the client, the pane set and `enabled` do. `enabled`
 * is the same gate the poll loops use: a backgrounded app or a covered screen
 * has nobody to deliver to, and an SSH channel held open in the background is
 * the first thing iOS kills anyway.
 */
export function useHostEvents(
  client: HerdrClient | null,
  paneIds: readonly string[],
  enabled: boolean,
  onEvent: (event: HostEvent) => void
): boolean {
  const [live, setLive] = useState(false);
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);
  // Order-insensitive, so a poll that lists the same panes differently is not
  // a change. The feed dedupes too; this keeps the effect from re-running.
  const key = [...new Set(paneIds)].sort().join('\n');

  useEffect(() => {
    if (client === null || !enabled || key.length === 0) return;
    const feed = new EventFeed(
      client.socket,
      (event) => handler.current(event),
      (isLive) => setLive(isLive)
    );
    feed.watch(key.split('\n'));
    return () => {
      feed.stop();
      // React's own "reset when the inputs change": the next feed reports its
      // own liveness, and a stale true would slow the poll loop against a
      // stream that no longer exists.
      setLive(false);
    };
  }, [client, key, enabled]);

  return live;
}
