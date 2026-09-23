import { useCallback, useEffect, useState } from 'react';

import type { HerdrClient } from '@/lib/herdr/client';
import { HerdrError } from '@/lib/herdr/protocol';
import type { WatcherState } from '@/lib/notifier/watcher';

export interface WatcherControl {
  /** Null until the host has answered, or when it could not be asked. */
  state: WatcherState | null;
  busy: boolean;
  error: string | null;
  /** Install, update or restart the watcher, whichever the state calls for. */
  install: () => Promise<void>;
}

/**
 * The notification watcher on one host: whether it runs, and a way to put it
 * there. Asked once per client while notifications are on. A host that cannot
 * be asked shows nothing rather than an error; the toggle above already says
 * whether registration worked.
 */
export function useWatcher(client: HerdrClient | null, enabled: boolean): WatcherControl {
  const [state, setState] = useState<WatcherState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (client === null || !enabled) return;
    let alive = true;
    client.watcherStatus().then(
      (next) => {
        if (alive) setState(next);
      },
      () => undefined
    );
    return () => {
      alive = false;
    };
  }, [client, enabled]);

  const install = useCallback(async () => {
    if (client === null) return;
    setBusy(true);
    setError(null);
    try {
      setState(await client.installWatcher());
    } catch (thrown) {
      setError(thrown instanceof HerdrError ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }, [client]);

  return { state, busy, error, install };
}
