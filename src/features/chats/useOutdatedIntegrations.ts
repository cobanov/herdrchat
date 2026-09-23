import { useCallback, useEffect, useState } from 'react';

import type { HerdrClient } from '@/lib/herdr/client';
import { HerdrError } from '@/lib/herdr/protocol';

export interface OutdatedIntegrations {
  /** Integrations the host reports as outdated. Empty when none, or unknown. */
  outdated: readonly ('claude' | 'codex')[];
  updating: boolean;
  error: string | null;
  /** Reinstall every outdated integration, then ask the host again. */
  update: () => Promise<void>;
}

/**
 * Asks the host once per client whether herdr's Claude or Codex integration is
 * out of date, and offers the reinstall (#93). A host that cannot be asked
 * reports nothing: this is advice, never an error of its own.
 *
 * Keyed on the client, so switching hosts asks the new one. The screen that
 * uses it is itself keyed by connection, which resets this state with it.
 */
export function useOutdatedIntegrations(client: HerdrClient | null): OutdatedIntegrations {
  const [outdated, setOutdated] = useState<readonly ('claude' | 'codex')[]>([]);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (client === null) return;
    let alive = true;
    void client.outdatedIntegrations().then((list) => {
      if (alive) setOutdated(list ?? []);
    });
    return () => {
      alive = false;
    };
  }, [client]);

  const update = useCallback(async () => {
    if (client === null || outdated.length === 0) return;
    setUpdating(true);
    setError(null);
    try {
      for (const name of outdated) await client.installIntegration(name);
      setOutdated((await client.outdatedIntegrations()) ?? []);
    } catch (thrown) {
      setError(thrown instanceof HerdrError ? thrown.message : String(thrown));
    } finally {
      setUpdating(false);
    }
  }, [client, outdated]);

  return { outdated, updating, error, update };
}
