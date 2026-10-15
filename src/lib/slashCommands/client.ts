/**
 * Running the discovery script over a transport, and when to.
 *
 * Like the host theme check (`theme/hostThemeClient.ts`), a scan is a side
 * task that rides the chat list's poll: it never throws and never reports a
 * reason. Null is a failed scan, and the caller keeps the catalogue it has.
 */
import type { AgentInfo } from '../herdr/models';
import { SLASH_SCAN_INTERVAL_MS, SLASH_SCAN_TIMEOUT_MS } from '../herdr/timeouts';
import type { HerdrTransport } from '../herdr/transport';
import { discoveryCommand, MAX_PROJECTS_PER_SCAN, type ScanRequest } from './discover';
import { parseScanOutput, type ScanResult } from './parse';

/**
 * Whether the host-wide part is due, given when it last started (null: never,
 * or asked for by pull-to-refresh).
 */
export function slashScanDue(lastScan: number | null, now: number): boolean {
  return lastScan === null || now - lastScan >= SLASH_SCAN_INTERVAL_MS;
}

/**
 * The project folders the host-wide scan re-reads with it: those of the
 * Claude agents in the open chats, each once, at most `MAX_PROJECTS_PER_SCAN`.
 * A thread's own open reads its folder the first time; this is what keeps a
 * folder's commands fresh after that, on the same ten-minute cadence.
 */
export function projectFoldersToScan(agents: readonly Pick<AgentInfo, 'agent' | 'cwd'>[]): string[] {
  const folders: string[] = [];
  for (const agent of agents) {
    if (agent.agent !== 'claude' || agent.cwd === '' || folders.includes(agent.cwd)) continue;
    folders.push(agent.cwd);
    if (folders.length === MAX_PROJECTS_PER_SCAN) break;
  }
  return folders;
}

export async function scanSlashCommands(transport: HerdrTransport, request: ScanRequest): Promise<ScanResult | null> {
  if (!request.host && request.cwds.length === 0) return null;
  try {
    const result = await transport.exec(discoveryCommand(request), SLASH_SCAN_TIMEOUT_MS);
    if (!result.ok || result.exitCode !== 0) return null;
    return parseScanOutput(result.stdout, request);
  } catch {
    return null;
  }
}
