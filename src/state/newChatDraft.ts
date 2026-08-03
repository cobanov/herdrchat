import { create } from 'zustand';

/**
 * The working directory the folder picker chose, handed back to the new-chat
 * screen.
 *
 * A store rather than route params: `router.setParams` after `router.back()`
 * applies to the route that is going away, not the one being returned to, so the
 * value silently never arrived. A one-field store also means the new-chat screen
 * reads it during render instead of syncing it in an effect.
 */
interface NewChatDraft {
  pickedCwd: string | null;
  pick: (cwd: string) => void;
  clear: () => void;
}

export const useNewChatDraft = create<NewChatDraft>((set) => ({
  pickedCwd: null,
  pick: (cwd) => set({ pickedCwd: cwd }),
  clear: () => set({ pickedCwd: null }),
}));
