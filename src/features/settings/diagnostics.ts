/**
 * The block of facts a bug report needs, assembled in one place.
 *
 * Pure, so a test can pin the format without a device. The point is not that
 * these facts are hard to gather — it is that a person reporting a bug from a
 * phone will not gather them, and a report that arrives without them costs a
 * round-trip of questions before anyone can start.
 *
 * Deliberately excludes host names, usernames and addresses. Those identify
 * someone's machines on their own tailnet, and a diagnostics block is something
 * people paste into a public issue without reading it twice.
 */

export interface DiagnosticsFacts {
  version: string;
  build: string;
  platform: string;
  osVersion: string;
  /** How many hosts are configured. The count is useful; the names are not ours. */
  hostCount: number;
  newArchitecture: boolean;
  glassAvailable: boolean;
  /** The most recent connection failure, if there was one. */
  lastError: string | null;
  /**
   * The host's herdr version. Not ours — this is the number that explains why a
   * send is slow or a session never gets reported, and a report without it costs
   * a round-trip of questions.
   */
  herdrVersion: string | null;
}

export function formatDiagnostics(facts: DiagnosticsFacts): string {
  const lines = [
    `HerdrChat ${facts.version} (${facts.build})`,
    `${facts.platform} ${facts.osVersion}`,
    `New Architecture: ${facts.newArchitecture ? 'yes' : 'no'}`,
    `Liquid Glass: ${facts.glassAvailable ? 'yes' : 'no'}`,
    `Hosts configured: ${facts.hostCount}`,
    `herdr on host: ${facts.herdrVersion ?? 'not reported'}`,
  ];
  // Only when there is one. An empty "Last error: none" line invites the reader
  // to conclude nothing went wrong, which is the opposite of why they are
  // reading a diagnostics block.
  if (facts.lastError !== null) lines.push(`Last error: ${facts.lastError}`);
  return lines.join('\n');
}
