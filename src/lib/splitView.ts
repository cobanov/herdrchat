/**
 * When the chats stand beside the open chat, and how wide they are.
 *
 * Two questions, kept apart. Whether this device opens a chat as the detail
 * of the chats screen (beside the list when there is room, in its place when
 * not) is fixed for the device: an iPad, or an iPhone that unfolds. Whether
 * there is room is the window's width, which on an iPhone Duo changes with
 * every fold. Because the open chat is a selection rather than a pushed
 * screen, folding and unfolding only change the width, and the chat, its
 * draft and its scroll stay where they were.
 */

/** iPhones that unfold into a screen with room for the chats beside a chat. */
const FOLDABLE_MODELS: ReadonlySet<string> = new Set([
  'iPhone19,4', // iPhone Duo: a 466 pt cover screen, 669 × 951 pt open
]);

export function isFoldableModel(modelId: string | null): boolean {
  return modelId !== null && FOLDABLE_MODELS.has(modelId);
}

export interface SplitSizes {
  /** The narrowest window that shows two columns. */
  breakpoint: number;
  /** The sidebar's width from `fullSidebarFrom` up. */
  sidebar: number;
  /** The sidebar's width below `fullSidebarFrom`, so the chat keeps its room. */
  compactSidebar: number;
  fullSidebarFrom: number;
}

/** The sidebar's width in a window this wide, or null for one column. */
export function sidebarWidth(width: number, sizes: SplitSizes): number | null {
  if (width < sizes.breakpoint) return null;
  return width < sizes.fullSidebarFrom ? sizes.compactSidebar : sizes.sidebar;
}
