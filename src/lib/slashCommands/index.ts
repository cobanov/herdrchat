/**
 * Slash commands typed into the composer.
 *
 * The palette offers what the agent's own terminal offers for `/`: for
 * Claude, the built-ins of the Claude Code installed on the host plus the
 * person's, the project's and plugins' commands and skills, read off the host
 * by one bounded script (`discover.ts`) and cached per host (`catalogue.ts`);
 * for Codex, its own menu (`builtins.ts`). It filters the terminal's way
 * (`filter.ts`), and a pick sends or fills the terminal's way (`pick.ts`).
 */

export * from './types';
export { CLAUDE_BUILTINS, CODEX_BUILTINS } from './builtins';
export { binaryKey, discoveryCommand, type ScanRequest } from './discover';
export { parseScanOutput, type ScanResult } from './parse';
export { filterCommands, paletteQuery, paletteSections, type PaletteSection } from './filter';
export { pickSlashCommand, type SlashPick } from './pick';
export {
  applyScan,
  catalogueFor,
  deserializeCatalogueCache,
  emptyCatalogueCache,
  projectScanned,
  serializeCatalogueCache,
  type SlashCatalogueCache,
} from './catalogue';
export { scanSlashCommands, slashScanDue } from './client';

/**
 * Whether a message is a slash command: `/name` at the very start, then
 * whitespace or nothing. A path (`/Users/me/file.txt`) is not one, which
 * matters because a command is confirmed differently from a prompt.
 */
export function isSlashCommand(text: string): boolean {
  return /^\/[A-Za-z][\w:-]*(?:\s|$)/.test(text.trim());
}

// MARK: - The short list the palette offered before the catalogue
//
// Kept until the palette moves to the catalogue (`paletteSections`), so the
// thread screen that still imports them keeps working in between.

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
