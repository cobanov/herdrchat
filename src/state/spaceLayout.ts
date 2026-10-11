import { create } from 'zustand';

import type { ListedChat } from '@/features/chats/listedChat';

/**
 * The workspace whose layout the phone's sheet (`app/space-layout`) draws.
 *
 * A store rather than route params: the sheet draws the whole summary (its
 * tabs, layouts, agents and shells), which does not belong in a URL, and the
 * list that opens it already holds it. Set just before the sheet is pushed;
 * what the sheet shows is the workspace as it was then, a picture taken for a
 * glance, not a live view.
 */
export const useSpaceLayoutSheet = create<{
  summary: ListedChat | null;
  show: (summary: ListedChat) => void;
}>((set) => ({
  summary: null,
  show: (summary) => set({ summary }),
}));
