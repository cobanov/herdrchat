import { create } from 'zustand';

/**
 * Which chats have their agents bar open, by host and chat key. For the
 * session only: the bar is closed again on the next launch, and nothing about
 * it is worth a row in SQLite.
 */
interface AgentsBarState {
  open: Readonly<Record<string, boolean>>;
  toggle: (key: string) => void;
}

export const useAgentsBar = create<AgentsBarState>((set) => ({
  open: {},
  toggle: (key) => set((state) => ({ open: { ...state.open, [key]: state.open[key] !== true } })),
}));

/** The bar's key for a chat on a host. */
export function agentsBarKey(connectionId: string, chat: string): string {
  return `${connectionId}\n${chat}`;
}
