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
 * filed and in what format. Grok's is a log of ACP `session/update`s;
 * Antigravity's a log of its conversation's steps; Gemini CLI's a log of
 * messages, each written again as it changes.
 */
export type HistoryReader = 'claude' | 'codex' | 'pi' | 'grok' | 'agy' | 'gemini';

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
  /**
   * A menu takes its option's digit as the answer, with no Enter after it.
   * Where it does not (Codex, and any agent not known here), the digit only
   * moves the cursor and Enter picks.
   */
  digitAnswers?: boolean;
}

const MISSING = 'The agent reported an invalid session id. Resume the session on the host, then reload.';

export const AGENTS: Readonly<Record<string, AgentSpec>> = {
  claude: {
    name: 'Claude',
    reader: 'claude',
    integration: 'claude',
    defaultTitles: ['Claude Code', 'claude'],
    missing: MISSING,
    digitAnswers: true,
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
    // Idle, before the session has a name (herdr's grok.toml).
    defaultTitles: ['grok'],
    // `1`–`9` chooses an option directly (Grok's 03-keyboard-shortcuts.md).
    digitAnswers: true,
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
  // Antigravity CLI. herdr names it `agy`, its command, in snapshots and in
  // the session its integration reports; the integration itself is
  // `antigravity-cli`.
  agy: {
    name: 'Antigravity',
    reader: 'agy',
    integration: 'antigravity-cli',
    // Its title, idle or not: it never names its terminal after a conversation.
    defaultTitles: ['agy'],
    // The digit alone answers a permission or a question (measured, agy
    // 1.3.6); an Enter after it lands in the composer. Its trust menu has no
    // numbers and takes the arrows.
    digitAnswers: true,
    missing: 'The Antigravity conversation is identified, but its transcript is not in ~/.gemini/antigravity-cli/brain on this host. Resume that exact conversation on the host, then reload.',
  },
  // Gemini CLI. herdr detects it but has no integration for it, and keeps no
  // session reported for it from any source (measured on herdr 0.9.5, from
  // inside the pane too), so its chat is its screen. The reader opens the log
  // the day herdr reports one.
  gemini: {
    name: 'Gemini',
    reader: 'gemini',
    integration: null,
    // Before it starts, the shell's command title. Gemini's own titles are a
    // status and the folder (`◇  Ready (app)`, windowTitle.ts in 0.64), never
    // a topic, so `sessionTitle` reads none of them.
    defaultTitles: ['gemini'],
    missing: 'The Gemini session is identified, but its log is not in ~/.gemini/tmp on this host. Resume that exact session on the host, then reload.',
  },
  letta: { name: 'Letta', reader: null, integration: null, defaultTitles: [], missing: MISSING },
};

/** The table's entry for an agent kind, or undefined for one it doesn't know. */
export function agentSpec(kind: string | null | undefined): AgentSpec | undefined {
  return kind == null ? undefined : AGENTS[kind];
}

/** The agent kinds whose history the app reads, in the table's order. */
export const READABLE_AGENTS: readonly string[] = Object.keys(AGENTS).filter((kind) => AGENTS[kind]?.reader != null);

/**
 * The agent kind an integration reports for: `antigravity-cli` is agy's, and
 * every other one shares its agent's name. Unknown names come back as given.
 */
export function agentOfIntegration(integration: string): string {
  return Object.keys(AGENTS).find((kind) => AGENTS[kind]?.integration === integration) ?? integration;
}

/** An agent kind herdr has an integration for, which `herdr integration install` takes. */
export function integrationFor(kind: string | null | undefined): string | null {
  return agentSpec(kind)?.integration ?? null;
}
