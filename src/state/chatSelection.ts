import { create } from 'zustand';

export interface ChatSelection {
  connectionId: string;
  workspaceId: string;
  title: string;
  /** Set when one agent of a workspace is open rather than the workspace chat. */
  paneId?: string;
}

// Native tab presses reset route params. Keep the tablet selection outside the
// URL, bound to its host, so switching tabs does not discard the open detail.
export const useChatSelection = create<{
  selection: ChatSelection | null;
  select: (selection: ChatSelection | null) => void;
}>((set) => ({ selection: null, select: (selection) => set({ selection }) }));
