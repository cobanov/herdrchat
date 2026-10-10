import { useEffect, useMemo } from 'react';

import type { AgentInfo } from '@/lib/herdr/models';
import { SLASH_SCAN_AFTER_OPEN_DELAY_MS } from '@/lib/herdr/timeouts';
import type { HerdrTransport } from '@/lib/herdr/transport';
import { catalogueFor, projectScanned, type CatalogueAgent, type CatalogueCommand } from '@/lib/slashCommands';
import { scanSlashCatalogue, useSlashCatalogues } from '@/state/slashCommands';

const NONE: readonly CatalogueCommand[] = [];

/**
 * The agent a thread's `/` palette is for: the one its messages go to, which
 * `useThread` picks the same way (the focused agent, else the first). Its kind
 * decides the catalogue (Claude's, Codex's, or none for OMP and plain panes),
 * and its folder the project's own commands.
 */
export function paletteAgent(agents: readonly AgentInfo[]): { kind: CatalogueAgent; cwd: string | null } | null {
  const agent = agents.find((a) => a.focused && a.agent !== null) ?? agents.find((a) => a.agent !== null);
  if (agent === undefined) return null;
  if (agent.agent === 'claude' || agent.agent === 'codex') return { kind: agent.agent, cwd: agent.cwd === '' ? null : agent.cwd };
  return null;
}

/**
 * What the `/` palette offers in a thread: everything the agent's own
 * terminal would list for the same `/`, as the connection's catalogue holds
 * it (`src/state/slashCommands.ts`), or the static built-ins until a scan has
 * read the host. Empty for an agent with no catalogue.
 */
export function useSlashCommands(
  connectionId: string | null,
  agent: CatalogueAgent | null,
  cwd: string | null
): readonly CatalogueCommand[] {
  const cache = useSlashCatalogues((state) =>
    connectionId === null ? undefined : state.byConnection[connectionId]);
  return useMemo(
    () => (agent === null ? NONE : catalogueFor(cache ?? null, agent, cwd)),
    [cache, agent, cwd]
  );
}

/**
 * Read a Claude thread's project commands and skills (`<cwd>/.claude`) the
 * first time a thread opens on a folder this connection has not scanned.
 *
 * Only once the thread's first window has loaded (`ready`), and a moment
 * after that (`SLASH_SCAN_AFTER_OPEN_DELAY_MS`): the open is what the person
 * is waiting on, and the client runs one command at a time, so a scan sent
 * with it would hold the transcript up. The reverted b704ec8 scanned on every
 * open, ahead of the read. A folder already scanned (an empty list counts) is
 * never scanned from here again; the chats list's poll keeps the host-wide
 * part fresh. A failed scan is not retried until the thread opens again.
 */
export function useProjectSlashScan(
  connectionId: string | null,
  transport: HerdrTransport | null,
  agent: CatalogueAgent | null,
  cwd: string | null,
  ready: boolean
): void {
  const scanned = useSlashCatalogues((state) =>
    connectionId === null || cwd === null ? true : projectScanned(state.byConnection[connectionId] ?? null, cwd));
  useEffect(() => {
    // Codex has no project commands; its list is fixed.
    if (!ready || scanned || agent !== 'claude' || connectionId === null || transport === null || cwd === null) return;
    const timer = setTimeout(() => {
      void scanSlashCatalogue(connectionId, transport, { host: false, cwds: [cwd] });
    }, SLASH_SCAN_AFTER_OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, scanned, agent, connectionId, transport, cwd]);
}
