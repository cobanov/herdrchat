/**
 * What picking a command in the palette does, the terminal's rule: Enter on a
 * command runs it unless it cannot run without an argument, in which case it
 * completes the name and waits for the argument, with the hint showing what
 * goes there.
 *
 * A hint in brackets (`[model]`, `[pr]`) or one that says it is optional
 * (`<optional custom summarization instructions>`) is an argument the command
 * can do without: `/compact` compacts, `/model` opens its picker. Only a bare
 * `<…>` (`add-dir <path>`, `fork <directive>`) is one it needs. A computed
 * hint is read as none (`/effort`, whose hint is a getter, sends and opens its
 * panel, as Enter does in the terminal).
 *
 * One exception the terminal does not need: a command that ends the session
 * or the agent (`DESTRUCTIVE_COMMANDS`) is filled, never sent on a pick. In a
 * terminal it takes deliberate arrow keys and Enter; on a phone it is one tap
 * on a short scrolling list, and a mis-tap would end the chat.
 */
import type { CatalogueCommand } from './types';

export type SlashPick =
  /** Send `text` now, as a message. */
  | { action: 'send'; text: string }
  /**
   * Put `text` in the composer and show `placeholder` (when not empty) until
   * something is typed after it. A send is then the person's own tap.
   */
  | { action: 'fill'; text: string; placeholder: string };

/**
 * Commands, Claude's and Codex's, that end the agent, the session or the
 * sign-in, or throw the conversation away: `/exit`, `/quit`, `/logout`,
 * `/restart`, `/stop` (Claude: stop this background session), `/clear` (a new
 * session, so a new chat), and Codex's `/delete` and `/archive`.
 */
export const DESTRUCTIVE_COMMANDS: ReadonlySet<string> = new Set([
  'exit',
  'quit',
  'logout',
  'restart',
  'stop',
  'clear',
  'delete',
  'archive',
]);

/** Whether a hint names an argument the command cannot run without. */
export function hintRequiresArgument(hint: string | null): boolean {
  const text = hint?.trim() ?? '';
  return text.startsWith('<') && !/\boptional\b/i.test(text);
}

export function pickSlashCommand(command: Pick<CatalogueCommand, 'name' | 'argumentHint'>): SlashPick {
  const hint = command.argumentHint?.trim() ?? '';
  if (hintRequiresArgument(hint)) return { action: 'fill', text: `/${command.name} `, placeholder: hint };
  if (DESTRUCTIVE_COMMANDS.has(command.name)) return { action: 'fill', text: `/${command.name}`, placeholder: '' };
  return { action: 'send', text: `/${command.name}` };
}
