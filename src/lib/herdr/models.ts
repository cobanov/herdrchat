/**
 * The herdr wire model. Behaviour ported from the original SwiftUI implementation (see git
 * history before the Expo rewrite).
 *
 * Everything here decodes defensively: a newer herdr must not be able to break
 * the app by adding a status or a field, so unknown values degrade rather than
 * throw.
 */

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
}

/**
 * True when the integration reports a concrete native session id. Only then can
 * a transcript be targeted exactly — without it the newest-`.jsonl` guess may
 * hit a previous session's file.
 */
export function hasSessionId(agent: AgentInfo): boolean {
  return agent.agentSession?.kind === 'id' && (agent.agentSession?.value ?? '') !== '';
}

/**
 * Stable identity of the conversation(s) these agents host: the sorted, joined
 * Claude session ids.
 *
 * A chat's identity is its SESSION, not its workspace slot — this is what
 * distinguishes a new chat from the one that used the workspace before it.
 * Null when no agent reports a session id yet.
 */
export function sessionSignature(agents: readonly AgentInfo[]): string | null {
  const ids = agents
    .filter((agent) => agent.agent !== null && hasSessionId(agent))
    .map((agent) => agent.agentSession?.value ?? '')
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
  /** Null when this herdr's snapshot doesn't carry them — see above. */
  workspaces: Workspace[] | null;
  focusedPaneId: string | null;
  focusedTabId: string | null;
  focusedWorkspaceId: string | null;
  layouts: TabLayout[] | null;
  /** herdr's own version string, e.g. "0.7.3". Null if absent. */
  version: string | null;
  /** Wire protocol number. Null if absent. */
  protocol: number | null;
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
  };
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
  };
}

function decodeRect(raw: unknown): Rect {
  const value = record(raw);
  return { x: num(value.x), y: num(value.y), width: num(value.width), height: num(value.height) };
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
    workspaces,
    focusedPaneId: optionalStr(value.focused_pane_id),
    focusedTabId: optionalStr(value.focused_tab_id),
    focusedWorkspaceId: optionalStr(value.focused_workspace_id),
    layouts,
    version: optionalStr(value.version),
    protocol: typeof value.protocol === 'number' ? value.protocol : null,
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
