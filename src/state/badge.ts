import { create } from 'zustand';

/**
 * How many chats want attention, for the tab bar's badge.
 *
 * One writer (the chats list) and one reader (the tab layout). The layout has no
 * data of its own and the obvious fix — poll for it there — is the wrong one: it
 * would double every host's SSH round-trips and quietly defeat the whole
 * poll-rate preference, to show a number the screen underneath already knows.
 *
 * So the list publishes what it already computed. The badge is free.
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
  // this the tab layout would re-render each time to draw the same badge.
  setCount: (count) => set((state) => (state.count === count ? state : { count })),
}));
