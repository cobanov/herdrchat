import { create } from 'zustand';

/**
 * How many chats want attention.
 *
 * One writer (the chats list) and, for now, no reader. It fed the Chats tab's
 * badge, and the tab bar is gone: Chats is the root and Hosts and Settings are
 * sheets above it. Kept rather than deleted because the number is the one an app
 * icon badge or a mark on the menu would show, and recomputing it elsewhere —
 * polling for it — is the wrong way to get it: it would double every host's SSH
 * round-trips and quietly defeat the whole poll-rate preference, to show a
 * number the chats list already knows.
 *
 * So the list publishes what it already computed. A reader is free.
 */
interface Badge {
  /** Blocked agents plus unread threads, on the selected host only. */
  count: number;
  setCount: (count: number) => void;
}

export const useBadge = create<Badge>((set) => ({
  count: 0,
  // Guarded so an unchanged count does not notify subscribers. The chats list
  // recomputes this on every poll — a few times a minute, forever — and without
  // this any reader would re-render each time to draw the same number.
  setCount: (count) => set((state) => (state.count === count ? state : { count })),
}));
