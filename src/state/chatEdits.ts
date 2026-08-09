import { create } from 'zustand';

/**
 * A flag saying a modal changed something the chat list draws.
 *
 * A store rather than route params, for the reason already learned in
 * `newChatDraft`: `router.setParams` after `router.back()` applies to the route
 * being left, so the value never arrives.
 *
 * A flag rather than the new value itself: the list re-fetches on focus when
 * this is set, so the host stays the source of truth. Handing back the typed
 * name would put a second copy of it in the app, and the two would disagree the
 * first time herdr normalised or rejected one.
 *
 * The alternative — refreshing on every focus — would cost an SSH round-trip
 * each time you switch tabs, which is exactly the traffic the poll-rate
 * preference exists to control.
 */
interface ChatEdits {
  dirty: boolean;
  markDirty: () => void;
  clear: () => void;
}

export const useChatEdits = create<ChatEdits>((set) => ({
  dirty: false,
  markDirty: () => set({ dirty: true }),
  clear: () => set({ dirty: false }),
}));
