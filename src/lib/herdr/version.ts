/**
 * Which herdr a host is running, and what that lets the app do.
 *
 * The snapshot has carried `version` and `protocol` all along and nothing read
 * them. That is how the app ended up unable to tell a host that is missing a
 * feature from a host that is merely failing — and why the capability probes in
 * `client.ts` each cost a round-trip to re-discover something the very first
 * snapshot already said.
 *
 * Pure: no React, no transport. The whole point is that a test can pin the
 * comparison without a host.
 */

/**
 * The oldest herdr this app is known to work against.
 *
 * 0.7.x is not rejected — it works, on the legacy paths. This is the line below
 * which nothing has been tried at all.
 */
export const MIN_HERDR_VERSION = '0.7.0';

/**
 * The version that introduced the agent-aware verbs — `agent prompt`,
 * `agent start --kind --pane`, `pane wait-output`.
 *
 * Measured, not read off a changelog: on 0.7.4 `herdr agent --help` lists
 * neither `prompt` nor a `--kind` flag for `start`, and on 0.8.0 it lists both.
 */
export const AGENT_VERBS_VERSION = '0.8.0';

/** The wire protocol this app was written against. 0.7.4 spoke 16; 0.8.0 speaks 19. */
export const KNOWN_PROTOCOL = 19;

export interface HerdrVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parse a herdr version string.
 *
 * Tolerant of a leading `v` and of trailing build metadata, because this value
 * comes off the wire from a host we do not control. Returns null rather than
 * throwing: an unparseable version is a fact about the host, not an error in the
 * app, and every caller here treats "unknown" as "assume the old behaviour".
 */
export function parseVersion(raw: string | null | undefined): HerdrVersion | null {
  if (raw == null) return null;
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(raw.trim());
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/** Negative when `a` is older, zero when equal, positive when newer. */
export function compareVersions(a: HerdrVersion, b: HerdrVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * Whether a host is at least `required`.
 *
 * An unparseable or absent version answers FALSE for every gate. That is the
 * safe direction: the fallback paths work everywhere, so a false negative costs
 * the old behaviour, while a false positive sends a flag the host will reject.
 */
export function atLeast(hostVersion: string | null | undefined, required: string): boolean {
  const host = parseVersion(hostVersion);
  const floor = parseVersion(required);
  if (host === null || floor === null) return false;
  return compareVersions(host, floor) >= 0;
}

export type VersionVerdict =
  /** Older than anything this app has been tried against. */
  | { kind: 'unsupported'; version: string }
  /** Works, but on the legacy paths — no agent-aware verbs. */
  | { kind: 'legacy'; version: string }
  /** Everything is available. */
  | { kind: 'current'; version: string }
  /** The host did not report a version at all. */
  | { kind: 'unknown' };

/**
 * What to tell the user about a host's herdr.
 *
 * Three states rather than a boolean, because "too old to use" and "old enough
 * to be missing the fast paths" want different words. Telling someone to upgrade
 * when nothing is wrong is how a warning gets ignored.
 */
export function versionVerdict(raw: string | null | undefined): VersionVerdict {
  const parsed = parseVersion(raw);
  if (parsed === null || raw == null) return { kind: 'unknown' };
  const version = raw.trim();
  if (!atLeast(version, MIN_HERDR_VERSION)) return { kind: 'unsupported', version };
  if (!atLeast(version, AGENT_VERBS_VERSION)) return { kind: 'legacy', version };
  return { kind: 'current', version };
}

/**
 * One line a person can act on, or null when there is nothing worth saying.
 *
 * `current` returns null on purpose: a host that is fine should produce no
 * message at all. A banner that is always present is furniture.
 */
export function versionAdvice(verdict: VersionVerdict): string | null {
  switch (verdict.kind) {
    case 'unsupported':
      return `This host runs herdr ${verdict.version}. HerdrChat has only been tried against ${MIN_HERDR_VERSION} and later — run \`herdr update\` on it.`;
    case 'legacy':
      return `herdr ${verdict.version}. Sending is slower here: \`agent prompt\` arrived in ${AGENT_VERBS_VERSION}, so this host uses the older path that has to watch for delivery. \`herdr update\` on the host removes the wait.`;
    case 'current':
      return null;
    case 'unknown':
      return "This host didn't report its herdr version, so the older, slower send path is used.";
  }
}
