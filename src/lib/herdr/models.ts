/**
 * The herdr wire model. Behaviour ported from the original SwiftUI implementation (see git
 * history before the Expo rewrite).
 *
 * Everything here decodes defensively: a newer herdr must not be able to break
 * the app by adding a status or a field, so unknown values degrade rather than
 * throw.
 */

import { agentSpec, READABLE_AGENTS } from './agents';

/** Semantic agent state as reported by herdr (socket API `AgentStatus`). */
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

const KNOWN_STATUSES: readonly AgentStatus[] = ['idle', 'working', 'blocked', 'done', 'unknown'];

/** Unknown values decode to `unknown` so a newer herdr can't break the app. */
export function toAgentStatus(raw: unknown): AgentStatus {
  return typeof raw === 'string' && (KNOWN_STATUSES as readonly string[]).includes(raw)
    ? (raw as AgentStatus)
    : 'unknown';
}

/** Whether this status needs the user's attention (drives the unread badge). */
export function needsAttention(status: AgentStatus): boolean {
  return status === 'blocked';
}

/**
 * `agent_session` payload: how an integration identifies its native session.
 * For Claude Code, `kind: 'id'` and `value` is the session UUID — i.e. the exact
 * transcript filename.
 */
export interface AgentSessionRef {
  agent: string | null;
  kind: string | null;
  source: string | null;
  value: string | null;
}

/** One agent-bearing pane, as returned by `agent.list` / inside `session.snapshot`. */
export interface AgentInfo {
  /** Detected agent label, e.g. "claude"; null for plain panes. */
  agent: string | null;
  agentStatus: AgentStatus;
  cwd: string;
  foregroundCwd: string | null;
  focused: boolean;
  paneId: string;
  tabId: string;
  terminalId: string | null;
  workspaceId: string;
  agentSession: AgentSessionRef | null;
  /**
   * herdr's counter at this pane's last state change. A different value on the
   * next poll means it changed in between, even if it came back to the same
   * state: a turn that started and finished between two polls. Null from a
   * herdr too old to send it.
   */
  stateChangeSeq: number | null;
  /**
   * Set only when the current idle state is finished work, to that
   * transition's `stateChangeSeq`; startup, restore and session switches leave
   * it null (herdr #4457). Null from older herdr, which cannot tell.
   */
  completionSeq: number | null;
  /**
   * herdr sees a menu on the pane waiting for keys while the status stays
   * `idle`: Claude's folder-trust question on a first start, and the panel a
   * slash command opens. `agent.prompt` refuses the pane until it is answered
   * (`agent_input_pending`). False from a herdr too old to send it.
   */
  inputPending: boolean;
  /**
   * The name given with `herdr agent rename` (`feke-pm`), null when the agent
   * was never named.
   */
  name: string | null;
  /**
   * The session's own title, the one Claude Code and Codex set as the
   * terminal's title ("Feke animation smoothness"): what a person calls the
   * conversation. Without its status glyph, unlike herdr's `terminal_title`.
   * Null for a plain pane, or from a herdr too old to send it.
   */
  title: string | null;
}

/**
 * Pi and OMP (Oh My Pi, a Pi fork) write the same session journal, and both
 * Herdr integrations report its exact path. One reader serves both.
 */
export function isPiFamily(agent: string | null | undefined): boolean {
  return agentSpec(agent)?.reader === 'pi';
}

/**
 * True when the integration reports an exact native id, or a Pi/OMP session
 * path. A path is authoritative only for those; other agents require their id.
 */
export function hasSessionReference(agent: AgentInfo): boolean {
  const session = agent.agentSession;
  return (session?.value ?? '') !== '' &&
    (session?.kind === 'id' || (isPiFamily(agent.agent) && session?.kind === 'path'));
}

/** The agents whose transcripts this app reads and whose panes it talks to. */
export const CONVERSATIONAL_AGENTS: readonly string[] = READABLE_AGENTS;

/**
 * True for a pane holding an agent the app can hold a conversation with. A
 * plain shell, or an agent with no transcript reader, has no chat of its own.
 */
export function isConversationalAgent(agent: AgentInfo): boolean {
  return agent.agent !== null && CONVERSATIONAL_AGENTS.includes(agent.agent);
}

/**
 * True for a pane holding any agent herdr detects: each is a chat. One with
 * no transcript reader shows its screen in place of history (`useThread`).
 */
export function isChatAgent(agent: Pick<AgentInfo, 'agent'>): boolean {
  return agent.agent !== null;
}

/**
 * True when two polls saw the same agents, field for field. A poll that saw
 * nothing new keeps the list it had, so nothing built from it is rebuilt: a
 * fresh array every two seconds gave every visible thread row new props.
 */
export function sameAgents(a: readonly AgentInfo[], b: readonly AgentInfo[]): boolean {
  return a.length === b.length && a.every((agent, index) => JSON.stringify(agent) === JSON.stringify(b[index]));
}

/**
 * The pane a chat sends to: an agent whose transcript the thread shows, the
 * focused one first. Focus alone sent a Claude chat's message to a focused
 * agent the app cannot read, so the echo never confirmed ("Failed to send").
 * Any other agent only when the chat has no conversational one.
 */
export function sendTarget(agents: readonly AgentInfo[]): AgentInfo | null {
  const pick = (pool: readonly AgentInfo[]) => pool.find((a) => a.focused) ?? pool[0] ?? null;
  return pick(agents.filter(isConversationalAgent)) ?? pick(agents.filter((a) => a.agent !== null));
}

/** A pane's agent by name: "Claude", herdr's own id for one `AGENTS` doesn't name, "Terminal" for a shell. */
export function agentName(kind: string | null): string {
  return kind === null ? 'Terminal' : agentSpec(kind)?.name ?? kind;
}

/**
 * Stable identity of the conversation(s) these agents host.
 *
 * A chat's identity is its SESSION, not its workspace slot — this is what
 * distinguishes a new chat from the one that used the workspace before it.
 * Null when no agent reports a session id yet.
 */
export function sessionSignature(agents: readonly AgentInfo[]): string | null {
  const ids = agents
    .filter((agent) => agent.agent !== null && hasSessionReference(agent))
    // Claude's id stands bare, as it always has: cached chats are keyed by it.
    .map((agent) => isPiFamily(agent.agent)
      ? `${agent.agent}:${agent.agentSession?.kind}:${encodeURIComponent(agent.agentSession?.value ?? '')}`
      : agent.agent === 'claude'
        ? agent.agentSession?.value ?? ''
        : `${agent.agent}:${agent.agentSession?.value ?? ''}`)
    .filter((value) => value !== '');
  if (ids.length === 0) return null;
  return [...new Set(ids)].sort().join(',');
}

/** A workspace row, as returned by `workspace.list`. */
export interface Workspace {
  workspaceId: string;
  label: string;
  number: number;
  agentStatus: AgentStatus;
  focused: boolean;
  activeTabId: string | null;
  paneCount: number;
  tabCount: number;
}

/** A pane row, as returned by `pane.list`. */
export interface Pane {
  paneId: string;
  workspaceId: string;
  tabId: string;
  terminalId: string | null;
  agent: string | null;
  agentStatus: AgentStatus;
  cwd: string;
  foregroundCwd: string | null;
  focused: boolean;
  /**
   * The title the program in the pane gave its terminal, without a status
   * glyph (`terminal_title_stripped`, else `title`). Null for a shell that set
   * none, which is most of them.
   */
  title: string | null;
}

/**
 * Full runtime snapshot (`session.snapshot`).
 *
 * herdr returns the whole session in this one payload — workspaces, tabs, panes
 * and agents together. We used to decode only the agents and then ask for
 * `workspace list` separately, which was a second round-trip for data the first
 * one had already delivered. Over SSH that is not free.
 *
 * `workspaces` is nullable rather than an empty array because those two mean
 * different things: null is "this herdr didn't send the field", empty is "there
 * are no workspaces". Only the first is a reason to fall back to `workspace
 * list`, and conflating them would either strand us on an older herdr or make
 * us pay the extra round-trip forever.
 */
export interface Snapshot {
  agents: AgentInfo[];
  /**
   * Every pane, shells included: what a terminal row is made from. Empty from
   * a herdr whose snapshot does not carry them, which then has no terminal
   * rows rather than a second round-trip for them.
   */
  panes: Pane[];
  /** Null when this herdr's snapshot doesn't carry them — see above. */
  workspaces: Workspace[] | null;
  focusedPaneId: string | null;
  focusedTabId: string | null;
  focusedWorkspaceId: string | null;
  /**
   * Every tab of every workspace: its label and number, what a layout view
   * titles each tab by. Null from a herdr whose snapshot does not carry them;
   * the layouts alone still say which tabs there are.
   */
  tabs: Tab[] | null;
  layouts: TabLayout[] | null;
  /** herdr's own version string, e.g. "0.7.3". Null if absent. */
  version: string | null;
  /** Wire protocol number. Null if absent. */
  protocol: number | null;
  /** Panes herdr could not bring back after a restart. Empty before herdr #4400. */
  restoreErrors: RestoreError[];
}

/**
 * A pane whose saved session failed to come back (herdr's `restore_error`):
 * its directory is gone, or its shell would not start. herdr keeps the layout
 * and says why, rather than silently dropping it.
 */
export interface RestoreError {
  paneId: string;
  workspaceId: string;
  message: string;
}

/** A tab, as the snapshot's `tabs` carries it. */
export interface Tab {
  tabId: string;
  workspaceId: string;
  /** Its place among its workspace's tabs, from 1. */
  number: number;
  /** herdr's label: one the person gave, else the program in front ("zsh"). */
  label: string;
  /** The tab the desktop is showing, across every workspace (not its workspace's active tab). */
  focused: boolean;
  paneCount: number;
  agentStatus: AgentStatus;
}

export interface TabLayout {
  workspaceId: string;
  tabId: string;
  focusedPaneId: string | null;
  zoomed: boolean;
  panes: PaneBox[];
  splits: SplitInfo[];
}

export interface PaneBox {
  paneId: string;
  focused: boolean;
  rect: Rect;
}

export type SplitDirection = 'right' | 'down';

export interface SplitInfo {
  id: string;
  direction: SplitDirection;
  ratio: number;
  rect: Rect;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * `workspace.create` result: the new workspace and its root pane. The app starts
 * an agent in `rootPane` and can navigate straight to the new `workspace`.
 */
export interface WorkspaceCreation {
  workspace: Workspace;
  rootPane: { paneId: string; workspaceId: string };
}

// MARK: - Decoders
//
// Hand-written rather than schema-driven: herdr's shapes are small and stable,
// and the interesting behaviour is what happens to the parts that AREN'T (an
// unknown status, a missing layout, a pane with no agent).

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalStr(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function optionalNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function bool(value: unknown): boolean {
  return value === true;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function decodeAgentSessionRef(raw: unknown): AgentSessionRef | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = record(raw);
  return {
    agent: optionalStr(value.agent),
    kind: optionalStr(value.kind),
    source: optionalStr(value.source),
    value: optionalStr(value.value),
  };
}

export function decodeAgentInfo(raw: unknown): AgentInfo {
  const value = record(raw);
  return {
    agent: optionalStr(value.agent),
    agentStatus: toAgentStatus(value.agent_status),
    cwd: str(value.cwd),
    foregroundCwd: optionalStr(value.foreground_cwd),
    focused: bool(value.focused),
    paneId: str(value.pane_id),
    tabId: str(value.tab_id),
    terminalId: optionalStr(value.terminal_id),
    workspaceId: str(value.workspace_id),
    agentSession: decodeAgentSessionRef(value.agent_session),
    stateChangeSeq: optionalNum(value.state_change_seq),
    completionSeq: optionalNum(value.completion_seq),
    inputPending: value.input_pending === true,
    name: optionalStr(value.name),
    title: sessionTitle(value),
  };
}

/**
 * The session's title out of an agent's snapshot entry.
 *
 * For Claude, `title` is it, and `terminal_title_stripped` is the same text
 * from herdrs that predate `title`; `terminal_title` carries a status glyph in
 * front (`✳ `) and is never used. Codex is the other way round: herdr's `title`
 * is the first prompt cut off with an ellipsis ("can i control the codex app
 * from here, can you ask…"), while the terminal's title is the thread's name
 * followed by ` | ` and the folder ("Explain Codex agent controls | kenneth").
 */
function sessionTitle(value: Record<string, unknown>): string | null {
  const title = optionalStr(value.title);
  const stripped = optionalStr(value.terminal_title_stripped);
  if (value.agent === 'grok') {
    // Grok titles its terminal `grok`, or `<session> - grok` once the session
    // has a name; during a turn a braille spinner and activity text lead it,
    // and a prompt adds "⚠ Action Required" (herdr's grok.toml). The session
    // is the segment before ` - grok`; a bare `grok` names no chat.
    const parts = stripped?.split(' - ') ?? [];
    const named = parts.length >= 2 && parts[parts.length - 1] === 'grok'
      ? (parts[parts.length - 2] ?? '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/^Action Required\b/, '').trim()
      : '';
    return named !== '' ? named : title;
  }
  if (value.agent !== 'codex') return title ?? stripped;
  // Until the thread has a name, Codex's default title is the project's
  // folder alone ("kenneth"), which names no thread; a spinner or a
  // microphone dot may lead either form.
  const parts = stripped?.match(/^(.*) \| [^|]*$/);
  const named = parts?.[1]?.replace(/^[^\p{L}\p{N}]+/u, '').trim() ?? '';
  return named !== '' ? named : title;
}

export function decodeWorkspace(raw: unknown): Workspace {
  const value = record(raw);
  return {
    workspaceId: str(value.workspace_id),
    label: str(value.label),
    number: num(value.number),
    agentStatus: toAgentStatus(value.agent_status),
    focused: bool(value.focused),
    activeTabId: optionalStr(value.active_tab_id),
    paneCount: num(value.pane_count),
    tabCount: num(value.tab_count),
  };
}

export function decodePane(raw: unknown): Pane {
  const value = record(raw);
  return {
    paneId: str(value.pane_id),
    workspaceId: str(value.workspace_id),
    tabId: str(value.tab_id),
    terminalId: optionalStr(value.terminal_id),
    agent: optionalStr(value.agent),
    agentStatus: toAgentStatus(value.agent_status),
    cwd: str(value.cwd),
    foregroundCwd: optionalStr(value.foreground_cwd),
    focused: bool(value.focused),
    title: optionalStr(value.terminal_title_stripped) ?? optionalStr(value.title),
  };
}

function decodeRect(raw: unknown): Rect {
  const value = record(raw);
  return { x: num(value.x), y: num(value.y), width: num(value.width), height: num(value.height) };
}

export function decodeTab(raw: unknown): Tab {
  const value = record(raw);
  return {
    tabId: str(value.tab_id),
    workspaceId: str(value.workspace_id),
    number: num(value.number),
    label: str(value.label),
    focused: bool(value.focused),
    paneCount: num(value.pane_count),
    agentStatus: toAgentStatus(value.agent_status),
  };
}

function decodeTabLayout(raw: unknown): TabLayout {
  const value = record(raw);
  return {
    workspaceId: str(value.workspace_id),
    tabId: str(value.tab_id),
    focusedPaneId: optionalStr(value.focused_pane_id),
    zoomed: bool(value.zoomed),
    panes: array(value.panes).map((pane) => {
      const box = record(pane);
      return {
        paneId: str(box.pane_id),
        focused: bool(box.focused),
        rect: decodeRect(box.rect),
      };
    }),
    splits: array(value.splits).map((split) => {
      const info = record(split);
      return {
        id: str(info.id),
        direction: info.direction === 'down' ? ('down' as const) : ('right' as const),
        ratio: num(info.ratio),
        rect: decodeRect(info.rect),
      };
    }),
  };
}

export function decodeSnapshot(raw: unknown): Snapshot {
  const value = record(raw);
  // Layout geometry is optional so the app tolerates herdr shape changes.
  const layouts = Array.isArray(value.layouts) ? value.layouts.map(decodeTabLayout) : null;
  // `Array.isArray` rather than `array()`: an absent field must stay
  // distinguishable from an empty one, because only the first justifies a
  // second round-trip to `workspace list`.
  const workspaces = Array.isArray(value.workspaces)
    ? value.workspaces.map(decodeWorkspace)
    : null;
  return {
    agents: array(value.agents).map(decodeAgentInfo),
    panes: array(value.panes).map(decodePane),
    workspaces,
    focusedPaneId: optionalStr(value.focused_pane_id),
    focusedTabId: optionalStr(value.focused_tab_id),
    focusedWorkspaceId: optionalStr(value.focused_workspace_id),
    // Absent stays null, as `workspaces` does: an older herdr, not no tabs.
    tabs: Array.isArray(value.tabs) ? value.tabs.map(decodeTab) : null,
    layouts,
    version: optionalStr(value.version),
    protocol: typeof value.protocol === 'number' ? value.protocol : null,
    restoreErrors: array(value.panes).flatMap((raw) => {
      const pane = record(raw);
      const message = optionalStr(pane.restore_error);
      if (message === null || message.length === 0) return [];
      return [{ paneId: str(pane.pane_id), workspaceId: str(pane.workspace_id), message }];
    }),
  };
}

export function decodeWorkspaceCreation(raw: unknown): WorkspaceCreation {
  const value = record(raw);
  const root = record(value.root_pane);
  return {
    workspace: decodeWorkspace(value.workspace),
    rootPane: { paneId: str(root.pane_id), workspaceId: str(root.workspace_id) },
  };
}
