import { useCallback, useEffect, useState } from 'react';

import type { HerdrClient, IntegrationIssue } from '@/lib/herdr/client';
import { installCodexLauncher } from '@/lib/herdr/codexLauncher';
import { errorText } from '@/lib/herdr/protocol';

export interface OutdatedIntegrations {
  /** Integrations the host reports as outdated or missing. Empty when none, or unknown. */
  issues: readonly IntegrationIssue[];
  updating: boolean;
  error: string | null;
  /** Install every listed integration, then ask the host again. */
  update: () => Promise<void>;
}

/**
 * Asks the host once per client whether herdr's chat-agent integrations are
 * out of date (#93) or not installed at all, and offers the install. A host
 * that cannot be asked reports nothing: this is advice, never an error of its
 * own.
 *
 * Keyed on the client, so switching hosts asks the new one. The screen that
 * uses it is itself keyed by connection, which resets this state with it.
 */
export function useOutdatedIntegrations(client: HerdrClient | null): OutdatedIntegrations {
  const [issues, setIssues] = useState<readonly IntegrationIssue[]>([]);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (client === null) return;
    let alive = true;
    void client.integrationIssues().then((list) => {
      if (alive) setIssues(list ?? []);
    });
    return () => {
      alive = false;
    };
  }, [client]);

  const update = useCallback(async () => {
    if (client === null || issues.length === 0) return;
    setUpdating(true);
    setError(null);
    try {
      for (const { name } of issues) {
        await client.installIntegration(name);
        // As the thread's own install does: Codex reports its session through the launcher.
        if (name === 'codex') await installCodexLauncher(client.transport);
      }
      setIssues((await client.integrationIssues()) ?? []);
    } catch (thrown) {
      setError(errorText(thrown));
    } finally {
      setUpdating(false);
    }
  }, [client, issues]);

  return { issues, updating, error, update };
}
