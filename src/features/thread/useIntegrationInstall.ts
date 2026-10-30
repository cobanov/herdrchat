import { useCallback, useState } from 'react';

import { integrationFor } from '@/lib/herdr/agents';
import type { HerdrClient, IntegrationName } from '@/lib/herdr/client';
import { installCodexLauncher } from '@/lib/herdr/codexLauncher';
import type { AgentInfo } from '@/lib/herdr/models';
import { errorText } from '@/lib/herdr/protocol';

/**
 * Installing herdr's missing chat-agent integration from the thread.
 *
 * The thread already works out that this is what is wrong, an agent that
 * reports no session id for eighty seconds is almost always a host missing
 * the integration. Naming the command was better than nothing, but it still
 * meant putting the phone down and finding a terminal.
 *
 * `install` is undefined when there is nothing to install it with: no host,
 * or an agent herdr has no integration for.
 */
export function useIntegrationInstall(client: HerdrClient | null, agents: readonly AgentInfo[]) {
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const integrationKind = agents.find(agent => agent.agent === 'codex' && agent.agentSession === null)
    ?? agents.find(agent => agent.agentSession === null)
    ?? agents[0];
  // The agent's own integration; an agent herdr has none for gets no install button.
  const agentKind: IntegrationName | null = integrationFor(integrationKind?.agent);
  const install = useCallback(() => {
    if (client === null || installing || agentKind === null) return;
    setInstalling(true);
    setInstallError(null);
    void client
      .installIntegration(agentKind)
      .then(() => agentKind === 'codex' ? installCodexLauncher(client.transport) : undefined)
      .then(() => {
        // Deliberately no success banner. The integration binds at SessionStart,
        // so this agent keeps reporting nothing until it is restarted, and a
        // cheerful "Installed" over a screen that has not changed is exactly the
        // confusion this is meant to remove. The copy above already says so.
        setInstallError(null);
      })
      .catch((thrown: unknown) => {
        setInstallError(errorText(thrown));
      })
      .finally(() => setInstalling(false));
  }, [client, installing, agentKind]);
  return {
    agentKind,
    installing,
    installError,
    install: client === null || agentKind === null ? undefined : install,
  };
}
