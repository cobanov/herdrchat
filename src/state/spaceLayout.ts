import { create } from 'zustand';

import type { ListedChat } from '@/features/chats/listedChat';
import type { PaneOpen } from '@/features/spaces/openPane';

/**
 * The workspace whose layout the phone's sheet (`app/space-layout`) draws,
 * and the pane a box in it asked to open.
 *
 * A store rather than route params: the sheet draws the whole summary (its
 * tabs, layouts, agents and shells), which does not belong in a URL, and the
 * list that opens it already holds it. Set just before the sheet is pushed;
 * what the sheet shows is the workspace as it was then, a picture taken for a
 * glance, not a live view.
 *
 * `pending` is the hand back: a box sets it and closes the sheet, and the
 * chats underneath open it on their next focus (`usePendingPaneOpen`): the
 * JS state after the pop, not the end of the native dismissal, which may
 * still be animating. Navigating from the sheet in the same breath as
 * `router.back()` would put the push in the same batch as the pop.
 * `take` clears it as it reads it, so it opens once.
 */
export const useSpaceLayoutSheet = create<{
  summary: ListedChat | null;
  pending: PaneOpen | null;
  show: (summary: ListedChat) => void;
  request: (open: PaneOpen) => void;
  take: () => PaneOpen | null;
}>((set, get) => ({
  summary: null,
  pending: null,
  // A new sheet starts with nothing asked of it.
  show: (summary) => set({ summary, pending: null }),
  request: (open) => set({ pending: open }),
  take: () => {
    const { pending } = get();
    if (pending !== null) set({ pending: null });
    return pending;
  },
}));
