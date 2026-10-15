import { agentName, isChatAgent, type Pane } from '../herdr/models';
import type { ListMode } from '../listModes';

/**
 * Which panes get a terminal row in the chat list, and what the row says.
 *
 * Every agent herdr detects is a chat, its terminal the chat's header action;
 * one whose history the app cannot read (Letta) shows its screen as the chat.
 * Every other pane is a terminal row: a shell, a build, a `vim`.
 */

/** What every terminal row is titled. */
export const TERMINAL_ROW_TITLE = 'Terminal';

/** What a row says when herdr has not said which program runs there. */
export const UNKNOWN_PROCESS = 'Shell';

/** One terminal row: the pane, and the program in front in it when known. */
export interface TerminalPane {
  paneId: string;
  pane: Pane;
  /** `pane.process_info`'s foreground program ("zsh", "vim"), null until asked. */
  processName: string | null;
}

/** True for a pane with a terminal row of its own: anything that is not a chat. */
export function isTerminalRow(pane: Pick<Pane, 'agent'>): boolean {
  return !isChatAgent(pane);
}

/** A workspace's terminal rows, in herdr's order. */
export function terminalPanes(
  panes: readonly Pane[],
  workspaceId: string,
  processNames: ReadonlyMap<string, string> = new Map()
): TerminalPane[] {
  return panes
    .filter((pane) => pane.workspaceId === workspaceId && isTerminalRow(pane))
    .map((pane) => ({ paneId: pane.paneId, pane, processName: processNames.get(pane.paneId) ?? null }));
}

/**
 * The program, as a person names it: `-zsh` (a login shell) is `zsh`, and
 * `/usr/bin/vim` is `vim`. Null for nothing usable.
 */
export function cleanProcessName(raw: string | null | undefined): string | null {
  const name = (raw ?? '').trim().replace(/^-+/, '').split('/').pop() ?? '';
  return name.length > 0 ? name : null;
}

/**
 * What runs in the pane, for its row: the program herdr reports, else the
 * agent herdr detected (by its name), else the title the program gave its
 * terminal, else "Shell".
 */
export function processLabel(pane: Pick<Pane, 'agent' | 'title'>, processName: string | null): string {
  const program = cleanProcessName(processName);
  if (program !== null) return program;
  if (pane.agent !== null) return agentName(pane.agent);
  const title = pane.title?.trim() ?? '';
  return title.length > 0 ? title : UNKNOWN_PROCESS;
}

/**
 * The program in front, from a `pane.process_info` result (the socket's, or
 * the CLI's `result`): the first foreground process's name. Null when herdr
 * did not say.
 */
export function decodeProcessName(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null;
  const info = (result as Record<string, unknown>).process_info ?? result;
  if (typeof info !== 'object' || info === null) return null;
  const processes = (info as Record<string, unknown>).foreground_processes;
  if (!Array.isArray(processes)) return null;
  for (const process of processes as unknown[]) {
    if (typeof process !== 'object' || process === null) continue;
    const record = process as Record<string, unknown>;
    const name = cleanProcessName(typeof record.name === 'string' ? record.name : typeof record.argv0 === 'string' ? record.argv0 : null);
    if (name !== null) return name;
  }
  return null;
}

/**
 * Which panes to ask for their program on this poll: one seen for the first
 * time (or whose terminal changed under a recycled pane id) now, every pane
 * on a sweep.
 */
export function processNamesDue(
  panes: readonly TerminalPane[],
  known: ReadonlyMap<string, { terminalId: string | null }>,
  sweep: boolean
): string[] {
  return panes
    .filter((row) => sweep || known.get(row.paneId)?.terminalId !== row.pane.terminalId || !known.has(row.paneId))
    .map((row) => row.paneId);
}

/**
 * Whether the chat list asks herdr for its panes' programs at all: only while
 * it shows Spaces, the one view with terminal rows, and only where a terminal
 * can open (iOS). Elsewhere the names would go nowhere, and each round is an
 * SSH exec.
 */
export function processNamesWanted(listMode: ListMode, terminalAvailable: boolean): boolean {
  return terminalAvailable && listMode === 'spaces';
}
