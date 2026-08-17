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

import type { AgentInfo } from '@/lib/herdr/models';

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
  /**
   * herdr's verdict on why one agent reads as it does — the SUMMARY, never the
   * raw `agent explain --json`. Build it with `summarizeAgentExplain`.
   *
   * Optional because it is the only fact here that needs the host to answer.
   * Off the tailnet the rest of the block is still worth pasting, so a missing
   * value is not an error — it is a line that is simply not there.
   */
  agentExplain?: string | null;
}

/**
 * Which agent is worth explaining, as a pane id.
 *
 * A diagnostics block has room for one. Prefer a blocked agent, because that is
 * the state people file bugs about; then the focused one, because that is the
 * one they were looking at. A pane with no agent explains nothing.
 */
export function explainTarget(agents: readonly AgentInfo[]): string | null {
  const withAgent = agents.filter((agent) => agent.agent !== null);
  const chosen =
    withAgent.find((agent) => agent.agentStatus === 'blocked') ??
    withAgent.find((agent) => agent.focused) ??
    withAgent[0];
  return chosen?.paneId ?? null;
}

/**
 * herdr's detection verdict as one short line, or null.
 *
 * `agent explain --json` is NOT pasteable as it stands. Measured against herdr
 * 0.8.0 it is ~7 KB, and it carries `manifest_source` — an absolute path, so the
 * host's username — and `evaluated_rules[].evidence.region_preview`, which is a
 * slice of the agent's actual terminal screen. This block promises the opposite
 * of that in its own footer and is written to be pasted into a public issue.
 *
 * What a bug report actually needs from it is the verdict and the rule that
 * produced it, both of which are host-independent. So this reads an allow-list
 * of scalars and drops everything else, rather than trying to scrub a shape
 * that may grow new fields later. Anything unparseable is simply omitted: a
 * blob we cannot vet is a blob we do not paste.
 */
export function summarizeAgentExplain(json: string | null): string | null {
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const state = record.state;
  if (typeof state !== 'string') return null;

  const matched = record.matched_rule;
  const ruleId =
    typeof matched === 'object' && matched !== null && typeof (matched as Record<string, unknown>).id === 'string'
      ? ((matched as Record<string, unknown>).id as string)
      : 'no rule';

  const visible = (['visible_blocker', 'visible_idle', 'visible_working'] as const)
    .filter((key) => record[key] === true)
    .map((key) => key.replace('visible_', ''));

  const screen = visible.length > 0 ? `, screen ${visible.join('+')}` : '';
  return `${state} via ${ruleId}${screen}`;
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
  // Same rule: present only when the host answered. It is one line because a
  // bug report is read, not parsed.
  if (facts.agentExplain != null && facts.agentExplain !== '') {
    lines.push(`Agent detection: ${facts.agentExplain}`);
  }
  return lines.join('\n');
}
