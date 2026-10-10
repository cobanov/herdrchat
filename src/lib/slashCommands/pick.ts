/**
 * What picking a command in the palette does, the terminal's rule: Enter on a
 * command that takes nothing runs it; on one that takes an argument it
 * completes the name and waits for the argument, with the hint showing what
 * goes there.
 */
import type { CatalogueCommand } from './types';

export type SlashPick =
  /** Send `text` now, as a message. */
  | { action: 'send'; text: string }
  /** Put `text` in the composer and show `placeholder` until something is typed after it. */
  | { action: 'fill'; text: string; placeholder: string };

export function pickSlashCommand(command: Pick<CatalogueCommand, 'name' | 'argumentHint'>): SlashPick {
  const hint = command.argumentHint?.trim() ?? '';
  return hint.length === 0
    ? { action: 'send', text: `/${command.name}` }
    : { action: 'fill', text: `/${command.name} `, placeholder: hint };
}
