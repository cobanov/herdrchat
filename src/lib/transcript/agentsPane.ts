/**
 * Claude Code's agents pane, read off the pane's visible screen.
 *
 * While a session runs background agents, Claude Code draws a list of them
 * under the prompt box (its footer then says `← for agents · ↓ to manage`):
 *
 * ```
 *   ⏺ main
 *   ◯ fork             Verifying the ingest output                26m 52s · ↓ 156.7k tokens
 *   ◯ general-purpose  Removing the old virtualenv              1h 13m 1s · ↓ 286.9k tokens
 *   ↓ 3 more
 * ```
 *
 * A header naming the main agent, one row per agent (a state mark, the kind,
 * the task, how long it has run and what it has spent), and a count of the
 * rows the pane had no room for. The app draws it natively above the
 * composer, and the live preview treats every line of it as chrome: scraped
 * as prose it read as the agent's answer, and its last row even read as the
 * spinner line.
 *
 * As with every screen read, when in doubt return nothing: a row that does
 * not parse ends the pane, and no header or no rows is no pane at all. Codex
 * and the other agents never draw one.
 */

import { clean } from './ansi';

export type AgentRowState = 'running' | 'done' | 'failed';

export interface AgentRow {
  state: AgentRowState;
  /** As Claude Code names it: `fork`, `general-purpose`, a custom agent's name. */
  kind: string;
  task: string;
  /** How long it had run when the screen was read. */
  elapsedMs: number;
  /** What it had spent so far; null when the figure did not parse. */
  tokens: number | null;
}

export interface AgentsPane {
  rows: AgentRow[];
  /** The rows below the pane's fold, from its `↓ N more` line. */
  hidden: number;
}

/**
 * One row, after `clean` has trimmed its indent: a state mark, the kind, two
 * or more spaces, the task, two or more spaces, the elapsed time, then
 * ` · ↓ <tokens> tokens`. The columns are padded to align, which is what the
 * two-space gaps rely on; the task may hold anything, a `·` included, and is
 * matched lazily so the anchored tail decides where it ends.
 */
export const AGENT_ROW =
  /^([◯○◉⏺●✓✔✗✘×])️?\s+([A-Za-z0-9_.-]+)\s{2,}(\S.*?)\s{2,}(\d+[hms](?:\s+\d+[hms]){0,2})\s+·\s+↓\s+(\d+(?:\.\d+)?[kKmM]?)\s+tokens?$/u;

/** The pane's header: the main agent, under a filled record mark (`●` off macOS). */
const HEADER = /^[⏺●]️?\s*main$/u;

/** `↓ 3 more`: the rows the pane folded away. */
const MORE = /^↓\s+(\d+)\s+more$/u;

/** Hollow marks a running agent; filled marks and ticks a finished one; crosses a failed one. */
const DONE_GLYPHS = '⏺●◉✓✔';
const FAILED_GLYPHS = '✗✘×';

export function parseAgentsPane(screen: string): AgentsPane | null {
  const lines = screen.split('\n').map(clean);
  // The last header: the pane sits at the bottom of the screen, under the
  // composer, so an older one scrolled into the history is not it.
  let header = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (HEADER.test(lines[index] ?? '')) {
      header = index;
      break;
    }
  }
  if (header < 0) return null;
  const rows: AgentRow[] = [];
  let index = header + 1;
  for (; index < lines.length; index += 1) {
    const row = parseAgentRow(lines[index] ?? '');
    if (row === null) break;
    rows.push(row);
  }
  if (rows.length === 0) return null;
  const more = MORE.exec(lines[index] ?? '');
  return { rows, hidden: more === null ? 0 : Number(more[1]) };
}

/** One cleaned line as a pane row, or null when it is not one. */
export function parseAgentRow(line: string): AgentRow | null {
  const match = AGENT_ROW.exec(line);
  if (match === null) return null;
  const [, glyph = '', kind = '', task = '', elapsed = '', tokens = ''] = match;
  const elapsedMs = parseElapsed(elapsed);
  if (elapsedMs === null) return null;
  return { state: rowState(glyph), kind, task: task.trim(), elapsedMs, tokens: parseTokenCount(tokens) };
}

/** Whether a cleaned line is part of the pane: its header, a row, or its `↓ N more`. */
export function isAgentsPaneLine(line: string): boolean {
  return HEADER.test(line) || MORE.test(line) || parseAgentRow(line) !== null;
}

export function rowState(glyph: string): AgentRowState {
  if (FAILED_GLYPHS.includes(glyph)) return 'failed';
  if (DONE_GLYPHS.includes(glyph)) return 'done';
  return 'running';
}

/**
 * `1h 13m 1s`, `26m 52s`, `45s`, `2h 3m`, `1h` in milliseconds. Each unit at
 * most once and in that order; anything else is null.
 */
export function parseElapsed(text: string): number | null {
  const match = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/.exec(text.trim());
  if (match === null || text.trim().length === 0) return null;
  const [, hours = '0', minutes = '0', seconds = '0'] = match;
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1_000;
}

/** `980`, `156.7k`, `1.2M` as a number of tokens; null when it is not one. */
export function parseTokenCount(text: string): number | null {
  const match = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(text.trim());
  if (match === null) return null;
  const [, value = '0', unit = ''] = match;
  const scale = unit === '' ? 1 : unit.toLowerCase() === 'k' ? 1_000 : 1_000_000;
  return Math.round(Number(value) * scale);
}
