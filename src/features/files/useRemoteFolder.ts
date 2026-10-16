import { useCallback, useEffect, useState } from 'react';

import { listFolder, type RemoteListing } from '@/lib/files/remoteFiles';
import type { HerdrClient } from '@/lib/herdr/client';
import { POLL_TIMEOUT_MS } from '@/lib/herdr/timeouts';

interface Answer {
  /** Which request this answers: the path and the reload count. */
  key: string;
  listing: RemoteListing | null;
  error: string | null;
}

/**
 * One folder of a device, listed when it is opened and again on `reload`; a
 * null path is the home folder. Loading is "the answer on hand is for another
 * request", so nothing is set in the effect itself.
 */
export function useRemoteFolder(client: HerdrClient | null, path: string | null) {
  const [version, setVersion] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const key = `${path ?? '~'}\n${version}`;

  useEffect(() => {
    if (client === null) return;
    let alive = true;
    void listFolder(client.transport, path, POLL_TIMEOUT_MS).then((result) => {
      if (alive) setAnswer({ key, listing: result.ok ? result.value : null, error: result.ok ? null : result.message });
    });
    return () => {
      alive = false;
    };
  }, [client, path, key]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const current = answer?.key === key ? answer : null;
  return { listing: current?.listing ?? null, error: current?.error ?? null, loading: client !== null && current === null, reload };
}
