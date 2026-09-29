/**
 * Slash commands typed into the composer.
 *
 * Claude's own `/` palette cannot be read off the pane (it is clipped to the
 * viewport and scrolls), and discovering commands on disk was tried and
 * reverted: the scan sat in front of every other SSH call. So the palette
 * offers a short list of built-ins that make sense from a phone, and anything
 * else still goes through when typed in full.
 */

export interface SlashCommand {
  name: string;
  /** What it does, in a few words. */
  detail: string;
}

/** Built-ins measured on Claude Code 2.1.285. Each either prints or opens a panel. */
export const CLAUDE_COMMANDS: readonly SlashCommand[] = [
  { name: 'model', detail: 'Switch the model' },
  { name: 'effort', detail: 'How hard Claude thinks' },
  { name: 'compact', detail: 'Summarise to free up context' },
  { name: 'context', detail: 'What fills the context window' },
  { name: 'usage', detail: 'Cost and usage so far' },
  { name: 'clear', detail: 'Start a fresh conversation' },
];

/**
 * Whether a message is a slash command: `/name` at the very start, then
 * whitespace or nothing. A path (`/Users/me/file.txt`) is not one, which
 * matters because a command is confirmed differently from a prompt.
 */
export function isSlashCommand(text: string): boolean {
  return /^\/[A-Za-z][\w:-]*(?:\s|$)/.test(text.trim());
}

/**
 * The commands to offer for a draft: while it is still just `/` and a partial
 * name. Once there is a space the name is done and the palette gets out of
 * the way of the arguments.
 */
export function commandSuggestions(draft: string, commands: readonly SlashCommand[]): SlashCommand[] {
  const match = /^\/([\w:-]*)$/.exec(draft);
  if (match === null) return [];
  const typed = (match[1] ?? '').toLowerCase();
  const found = commands.filter((command) => command.name.startsWith(typed));
  // A command typed in full has nothing left to suggest.
  return found.length === 1 && found[0]?.name === typed ? [] : found;
}
