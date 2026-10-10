/**
 * Running the discovery script over a transport, and when to.
 *
 * Like the host theme check (`theme/hostThemeClient.ts`), a scan is a side
 * task that rides the chat list's poll: it never throws and never reports a
 * reason. Null is a failed scan, and the caller keeps the catalogue it has.
 */
import { SLASH_SCAN_INTERVAL_MS, SLASH_SCAN_TIMEOUT_MS } from '../herdr/timeouts';
import type { HerdrTransport } from '../herdr/transport';
import { discoveryCommand, type ScanRequest } from './discover';
import { parseScanOutput, type ScanResult } from './parse';

/**
 * Whether the host-wide part is due, given when it last started (null: never,
 * or asked for by pull-to-refresh).
 */
export function slashScanDue(lastScan: number | null, now: number): boolean {
  return lastScan === null || now - lastScan >= SLASH_SCAN_INTERVAL_MS;
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
