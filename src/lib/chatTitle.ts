import { isConversationalAgent, type AgentInfo } from './herdr/models';

/**
 * What a chat is called.
 *
 * A chat's identity is its Claude session, not its workspace slot, and its
 * name follows: the title the session gave itself ("Feke animation
 * smoothness") is what a person calls the conversation. The workspace label
 * (`feke`) is a folder or a slot, and it used to be the only title, so two
 * chats run one after the other in one slot read the same.
 */
export interface TitleParts {
  /** The session's own title, as herdr reports it (`AgentInfo.title`). */
  sessionTitle: string | null | undefined;
  /** The name given with `herdr agent rename` (`AgentInfo.name`). */
  agentName: string | null | undefined;
  workspaceLabel: string | null | undefined;
  workspaceId: string | null | undefined;
}

/**
 * The first of the session title, the agent's herdr name, the workspace label
 * and the workspace id that says something, trimmed. Empty only when none
 * does. Nothing is cut: a row wraps a long title onto a second line.
 */
export function chatTitle({ sessionTitle, agentName, workspaceLabel, workspaceId }: TitleParts): string {
  for (const candidate of [namesSomething(sessionTitle), agentName, workspaceLabel, workspaceId]) {
    const trimmed = candidate?.trim() ?? '';
    if (trimmed !== '') return trimmed;
  }
  return '';
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
 * A starting or resumed session titles its terminal with the command or the
 * session id, which names nothing (`claude --resume 1b2c…`). The host's
 * notifier skips those for the same reason (`chat_title` in
 * `scripts/herdr-apns-notifier.py`).
 */
function namesSomething(title: string | null | undefined): string | null {
  const trimmed = title?.trim() ?? '';
  if (trimmed.startsWith('\\') || trimmed.includes('--resume') || SESSION_ID.test(trimmed)) return null;
  return trimmed;
}

const SESSION_ID = /[0-9a-f]{8}-[0-9a-f]{4}/;
