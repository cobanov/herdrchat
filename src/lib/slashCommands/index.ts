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
export { DESTRUCTIVE_COMMANDS, hintRequiresArgument, pickSlashCommand, type SlashPick } from './pick';
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
