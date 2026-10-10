import type { SheetAction } from './actionSheet';

/**
 * What the chats list lists: Spaces or Agents, picked from its title.
 *
 * Spaces is the list as it always was: a card per herdr workspace, with each
 * agent of a workspace that runs several hung under it. That answers "what is
 * open on the host", but a person driving agents asks "which agent wants me",
 * and with two agents in one workspace the answer sat one level down, under a
 * card that rolls both agents' states into one. Agents lists every
 * conversational agent as a row of its own, flat, across the host and its
 * machines; a workspace with no agent in it (a shell) is not a conversation
 * and is left out.
 *
 * Two views of one list, not two places: pins, reads and the open chat are the
 * same in both, so the choice is a title menu rather than a tab or a screen.
 */
export const LIST_MODES = ['spaces', 'agents'] as const;
export type ListMode = (typeof LIST_MODES)[number];

/** A first launch, and an install from before the picker, opens on the list it always had. */
export const DEFAULT_LIST_MODE: ListMode = 'spaces';

export function isListMode(value: unknown): value is ListMode {
  return (LIST_MODES as readonly unknown[]).includes(value);
}

/** A stored value back to a mode. A missing or unknown row is the default, never a blank list. */
export function decodeListMode(value: string | null): ListMode {
  return isListMode(value) ? value : DEFAULT_LIST_MODE;
}

/**
 * The view's name, which is the list's title. herdr calls them workspaces;
 * the picker says Spaces, a word that fits a phone's large title and reads
 * as a place rather than as herdr's term of art.
 */
export function listModeTitle(mode: ListMode): string {
  return mode === 'agents' ? 'Agents' : 'Spaces';
}

/** What the picker's sheet is titled: it chooses what the list shows. */
export const LIST_MODE_SHEET_TITLE = 'Show';

export interface ListModeChoice {
  mode: ListMode;
  /** The row's text. The system sheet draws no check mark, so the current view carries one in its label. */
  label: string;
  current: boolean;
}

/** The picker's rows, in the order the sheet lists them, the current one ticked. */
export function listModes(current: ListMode): ListModeChoice[] {
  return LIST_MODES.map((mode) => ({
    mode,
    label: mode === current ? `${listModeTitle(mode)} ✓` : listModeTitle(mode),
    current: mode === current,
  }));
}

/**
 * The picker's rows as sheet actions. Picking the view already shown does
 * nothing: it is how a person closes the sheet having only looked.
 */
export function listModeActions(current: ListMode, choose: (mode: ListMode) => void): SheetAction[] {
  return listModes(current).map(({ mode, label, current: isCurrent }) => ({
    label,
    onPress: () => {
      if (!isCurrent) choose(mode);
    },
  }));
}

/** What the title says to VoiceOver and Voice Control: the view, and that it is a control. */
export function listModeAccessibilityLabel(mode: ListMode): string {
  return `Showing ${listModeTitle(mode)}. Change view.`;
}
