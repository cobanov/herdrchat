import { create } from 'zustand';

interface ChatSelection {
  connectionId: string;
  workspaceId: string;
  title: string;
}

// Native tab presses reset route params. Keep the tablet selection outside the
// URL, bound to its host, so switching tabs does not discard the open detail.
export const useChatSelection = create<{
  selection: ChatSelection | null;
  select: (selection: ChatSelection | null) => void;
}>((set) => ({ selection: null, select: (selection) => set({ selection }) }));
