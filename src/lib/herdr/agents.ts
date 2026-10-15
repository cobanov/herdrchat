/**
 * What the app knows about each agent herdr can detect, in one table.
 *
 * The agent's kind is herdr's own id (`agent_session.agent`, `agent start
 * --kind`). Everything that once asked "is this Claude, Codex, Pi or OMP?" in
 * its own file asks this table instead, so supporting an agent is one entry
 * here plus, for its history, a reader in `src/lib/transcript/`.
 */

/**
 * Which transcript reader serves an agent's history: where its sessions are
 * filed and in what format. Grok's is a log of ACP `session/update`s.
 */
export type HistoryReader = 'claude' | 'codex' | 'pi' | 'grok';

export interface AgentSpec {
  /** How a person sees it named. */
  name: string;
  /** The reader for its history, or null while it has none. */
  reader: HistoryReader | null;
  /**
   * Its herdr integration, which is what reports the session. Null for an
   * agent herdr detects but has no integration for.
   */
  integration: string | null;
  /**
   * The terminal titles it sets before a conversation has a topic, which name
   * no chat (`Claude Code` in every pane).
   */
  defaultTitles: readonly string[];
  /** Said when herdr reported a session whose transcript cannot be found. */
  missing: string;
}

const MISSING = 'The agent reported an invalid session id. Resume the session on the host, then reload.';

export const AGENTS: Readonly<Record<string, AgentSpec>> = {
  claude: {
    name: 'Claude',
    reader: 'claude',
    integration: 'claude',
    defaultTitles: ['Claude Code', 'claude'],
    missing: MISSING,
  },
  codex: {
    name: 'Codex',
    reader: 'codex',
    integration: 'codex',
    defaultTitles: ['codex'],
    missing: 'The Codex session is identified, but its transcript is not in CODEX_HOME/sessions or archived_sessions on this host. Start or resume that exact session on the host, then reload.',
  },
  grok: {
    name: 'Grok',
    reader: 'grok',
    integration: 'grok',
    defaultTitles: [],
    missing: 'The Grok session is identified, but its folder is not in ~/.grok/sessions on this host. Resume that exact session on the host, then reload.',
  },
  pi: {
    name: 'Pi',
    reader: 'pi',
    integration: 'pi',
    defaultTitles: [],
    missing: 'The Pi session could not be located. Pi does not save a chat started with pi --no-session. Otherwise, resume that exact session on the host, then reload.',
  },
  omp: {
    name: 'OMP',
    reader: 'pi',
    integration: 'omp',
    defaultTitles: ['omp'],
    missing: 'The OMP session could not be located. Install the OMP integration and resume that exact session on the host, then reload.',
  },
  letta: { name: 'Letta', reader: null, integration: null, defaultTitles: [], missing: MISSING },
};

/** The table's entry for an agent kind, or undefined for one it doesn't know. */
export function agentSpec(kind: string | null | undefined): AgentSpec | undefined {
  return kind == null ? undefined : AGENTS[kind];
}

/** The agent kinds whose history the app reads, in the table's order. */
export const READABLE_AGENTS: readonly string[] = Object.keys(AGENTS).filter((kind) => AGENTS[kind]?.reader != null);

/** An agent kind herdr has an integration for, which `herdr integration install` takes. */
export function integrationFor(kind: string | null | undefined): string | null {
  return agentSpec(kind)?.integration ?? null;
}
