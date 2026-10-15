/**
 * What the palette shows for a draft, the way the terminal filters its own
 * `/` menu: names that start with what was typed, then names that contain it,
 * then descriptions that do. The typed text stays in the composer; only the
 * list narrows.
 */
import { SECTION_ORDER, type CatalogueCommand, type CommandSection } from './types';

/**
 * The partial name in a draft that is still choosing a command: `/` and
 * name characters, nothing after. Null once there is a space (the name is
 * done and the arguments are being typed) or for anything that is not a
 * command at all.
 */
export function paletteQuery(draft: string): string | null {
  const match = /^\/([\w:-]*)$/.exec(draft);
  return match === null ? null : (match[1] ?? '').toLowerCase();
}

/** 0 for a name prefix, 1 for a name substring, 2 for a description substring, null for none. */
function matchTier(command: CatalogueCommand, query: string): number | null {
  if (query.length === 0) return 0;
  const name = command.name.toLowerCase();
  if (name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;
  if (command.description.toLowerCase().includes(query)) return 2;
  return null;
}

/**
 * The commands that match `query`, best match first across the whole
 * catalogue (a name prefix in Skills before a description match in Built-in,
 * as the terminal ranks them); section order, then the catalogue's order,
 * breaks ties. With no query every command is a prefix match, so this is the
 * catalogue in section order.
 */
export function filterCommands(commands: readonly CatalogueCommand[], query: string): CatalogueCommand[] {
  const q = query.toLowerCase();
  const ranked: { command: CatalogueCommand; section: number; tier: number; index: number }[] = [];
  commands.forEach((command, index) => {
    const tier = matchTier(command, q);
    if (tier !== null) ranked.push({ command, section: SECTION_ORDER.indexOf(command.section), tier, index });
  });
  ranked.sort((a, b) => a.tier - b.tier || a.section - b.section || a.index - b.index);
  return ranked.map((entry) => entry.command);
}

export interface PaletteSection {
  /** Null for the ranked matches of a typed name, which carry no header. */
  section: CommandSection | null;
  commands: CatalogueCommand[];
}

/**
 * The palette for a draft. A bare `/` browses: every command in its section,
 * under the section's header. Once a name is being typed it searches: one
 * list, best match first across sections (`filterCommands`), with no headers,
 * since grouping by section would put a description match in Built-in above
 * the name the person is typing in Skills, out of view in a short palette.
 * Empty when the draft is not choosing a command, or nothing matches.
 */
export function paletteSections(draft: string, commands: readonly CatalogueCommand[]): PaletteSection[] {
  const query = paletteQuery(draft);
  if (query === null) return [];
  if (query.length > 0) {
    const matches = filterCommands(commands, query);
    return matches.length === 0 ? [] : [{ section: null, commands: matches }];
  }
  const sections: PaletteSection[] = [];
  for (const command of filterCommands(commands, query)) {
    const last = sections[sections.length - 1];
    if (last?.section === command.section) last.commands.push(command);
    else sections.push({ section: command.section, commands: [command] });
  }
  return sections;
}
