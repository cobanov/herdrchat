/**
 * The slash-command catalogue: what the composer's `/` palette offers.
 *
 * Every entry is something the agent's own terminal would list for the same
 * `/`: its built-ins, the person's and the project's commands and skills, and
 * installed plugins'. The palette groups them into sections in a fixed order
 * (`SECTION_ORDER`), the order a person scans them in.
 */

/** The agents with a catalogue. OMP panes get none. */
export type CatalogueAgent = 'claude' | 'codex';

/** A palette section, in display order (see `SECTION_ORDER`). */
export type CommandSection = 'builtin' | 'skills' | 'commands' | 'plugins';

export const SECTION_ORDER: readonly CommandSection[] = ['builtin', 'skills', 'commands', 'plugins'];

/**
 * Where an entry was found. Decides precedence when two share a name
 * (`SOURCE_PRECEDENCE`) and the order inside a section.
 *
 * - `builtin`: compiled into the agent (a `local`, `local-jsx` or `prompt` command).
 * - `bundled`: a skill compiled into Claude Code (`/batch`, `/debug`, …).
 * - `project`: `<cwd>/.claude/commands` or `<cwd>/.claude/skills`.
 * - `user`: `~/.claude/commands` or `~/.claude/skills`.
 * - `plugin`: an installed plugin's commands or skills.
 */
export type CommandSource = 'builtin' | 'bundled' | 'project' | 'user' | 'plugin';

/**
 * Who wins a name, first first. A built-in is what the terminal runs for its
 * name, so nothing on disk displaces it; then the terminal's own rule for
 * files: project over user over plugin. Bundled skills come last, since a
 * skill of the person's with the same name is the one they mean.
 */
export const SOURCE_PRECEDENCE: readonly CommandSource[] = ['builtin', 'project', 'user', 'plugin', 'bundled'];

export interface CatalogueCommand {
  /** Without the slash: `compact`, `foo:bar`, `demo-tools:lint`. */
  name: string;
  /** One line, as the terminal shows it. May be empty. */
  description: string;
  /**
   * What the command takes, as the terminal shows it after the name
   * (`[model]`, `<path>`). Null when it takes nothing or the hint is computed
   * at run time; either way a pick sends it at once (see `pick.ts`).
   */
  argumentHint: string | null;
  section: CommandSection;
  source: CommandSource;
}
