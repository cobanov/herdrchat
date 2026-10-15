import { create } from 'zustand';

export interface ChatSelection {
  connectionId: string;
  workspaceId: string;
  title: string;
  /** Set when one agent of a workspace is open rather than the workspace chat. */
  paneId?: string;
}

// Keep the tablet selection outside the URL, bound to its host, so opening and
// closing Hosts or Settings over the chats does not discard the open detail.
// (It moved here when native tab presses reset route params; the tabs are gone,
// but a store still outlives what the URL is doing.)
export const useChatSelection = create<{
  selection: ChatSelection | null;
  select: (selection: ChatSelection | null) => void;
}>((set) => ({ selection: null, select: (selection) => set({ selection }) }));
