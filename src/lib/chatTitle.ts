import { isConversationalAgent, type AgentInfo } from './herdr/models';

/**
 * What a chat is called.
 *
 * A chat's identity is its Claude session, not its workspace slot, and its
 * name follows: a name someone gave the agent (`herdr agent rename`), else the
 * title the session gave itself ("Feke animation smoothness"). The workspace
 * label (`feke`) is a folder or a slot, and it used to be the only title, so
 * two chats run one after the other in one slot read the same.
 */
export interface TitleParts {
  /** The session's own title, as herdr reports it (`AgentInfo.title`). */
  sessionTitle: string | null | undefined;
  /** The name given with `herdr agent rename` (`AgentInfo.name`). */
  agentName: string | null | undefined;
  workspaceLabel: string | null | undefined;
  workspaceId: string | null | undefined;
  /**
   * The folders of the workspace's panes. herdr labels a workspace after its
   * focused pane's folder and follows it until someone renames it, so a label
   * that names none of them was given by a person, and titles the chat over
   * the session's own title. Omitted: the label never outranks the session.
   */
  folders?: readonly (string | null | undefined)[];
}

/**
 * The first of the agent's herdr name, a workspace label someone chose, the
 * session title, the workspace label and the workspace id that says
 * something, trimmed. Empty only when none
 * does. Nothing is cut: a row wraps a long title onto a second line.
 *
 * The herdr name comes first because someone chose it, and a name a person
 * chose wins over one the model wrote. It is null until someone sets it.
 */
export function chatTitle({ sessionTitle, agentName, workspaceLabel, workspaceId, folders }: TitleParts): string {
  const chosen = folders !== undefined && isChosenLabel(workspaceLabel, folders) ? workspaceLabel : null;
  for (const candidate of [agentName, chosen, namesSomething(sessionTitle), workspaceLabel, workspaceId]) {
    const trimmed = candidate?.trim() ?? '';
    if (trimmed !== '') return trimmed;
  }
  return '';
}

/**
 * True when a workspace label was given by a person: it names none of the
 * workspace's folders, the name herdr would have given it (see `folders`).
 * With no folder known there is nothing to tell it from, so it is not.
 */
export function isChosenLabel(label: string | null | undefined, folders: readonly (string | null | undefined)[]): boolean {
  const names = folders.map((folder) => folder?.split('/').filter(Boolean).pop() ?? '').filter(Boolean);
  return (label?.trim() ?? '') !== '' && names.length > 0 && !names.some((name) => sameName(label, name));
}

/**
 * True when the title comes from the session or its agent rather than from
 * the workspace. Such a title leaves the workspace label to the line below it.
 */
export function titledBySession(parts: Pick<TitleParts, 'sessionTitle' | 'agentName'>): boolean {
  return chatTitle({ ...parts, workspaceLabel: null, workspaceId: null }) !== '';
}

/**
 * True when a workspace label and a folder name say the same word, ignoring
 * case and surrounding space. herdr names a workspace after its folder, so
 * they usually do, and a line that shows both says it twice.
 */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = a?.trim().toLowerCase() ?? '';
  return left !== '' && left === (b?.trim().toLowerCase() ?? '');
}

/**
 * The agent whose session names a chat over these agents: the one
 * conversational agent, or none. A workspace running two or more stands for
 * all of them, so it keeps its own label, and each agent's title goes on that
 * agent's row.
 */
export function titleAgent(agents: readonly AgentInfo[]): AgentInfo | null {
  const conversational = agents.filter(isConversationalAgent);
  return conversational.length === 1 ? conversational[0] ?? null : null;
}

/**
 * The title each agent puts on its terminal before its session has a topic,
 * by agent, as herdr names them. None of these names a conversation, so a
 * chat titled by one falls through to the agent's herdr name or the workspace;
 * otherwise every fresh chat reads the same.
 *
 * - Claude Code titles the terminal `Claude Code` until the session has a
 *   topic (2.1.296), with a status glyph in front (`✳ Claude Code`) that herdr
 *   strips from `terminal_title_stripped` but that is matched without it here
 *   too. Before it starts, the shell titles the terminal with the command.
 * - Codex (0.162) titles the terminal with its project's folder name alone
 *   until the thread has a name, then `name | folder`. That folder is not a
 *   fixed string, so the snapshot decoder handles it (`sessionTitle` in
 *   `herdr/models.ts`): a title without the ` | ` is not a thread name. What
 *   is left here is the shell's command title.
 * - OMP: nothing in this app or its fixtures shows OMP setting a terminal
 *   title of its own, so only the shell's command title is listed.
 *
 * Compared ignoring case, after any leading glyphs and space.
 */
export const DEFAULT_TERMINAL_TITLES: Readonly<Record<'claude' | 'codex' | 'omp', readonly string[]>> = {
  claude: ['Claude Code', 'claude'],
  codex: ['codex'],
  omp: ['omp'],
};

const DEFAULTS = new Set(Object.values(DEFAULT_TERMINAL_TITLES).flat().map((title) => title.toLowerCase()));

/**
 * True when a title is an agent's default terminal title rather than a topic,
 * whichever agent's it is: `Claude Code` names no conversation in any pane.
 */
export function isDefaultTerminalTitle(title: string | null | undefined): boolean {
  const bare = title?.replace(LEADING_GLYPHS, '').trim().toLowerCase() ?? '';
  return bare !== '' && DEFAULTS.has(bare);
}

/** Status glyphs and spinners in front of a title: `✳ `, `◑ `, `⠋ `. */
const LEADING_GLYPHS = /^[^\p{L}\p{N}\\]+/u;

/**
 * A starting or resumed session titles its terminal with the command or the
 * session id, which names nothing (`claude --resume 1b2c…`); so does an agent's
 * default title (`Claude Code`). The host's notifier skips both for the same
 * reason (`chat_title` in `scripts/herdr-apns-notifier.py`).
 */
function namesSomething(title: string | null | undefined): string | null {
  const trimmed = title?.trim() ?? '';
  if (trimmed.startsWith('\\') || trimmed.includes('--resume') || SESSION_ID.test(trimmed)) return null;
  if (isDefaultTerminalTitle(trimmed)) return null;
  return trimmed;
}

const SESSION_ID = /[0-9a-f]{8}-[0-9a-f]{4}/;
