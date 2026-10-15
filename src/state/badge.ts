import { create } from 'zustand';

/**
 * How many chats want attention.
 *
 * One writer (the chats list) and two readers: the Done of Hosts and of
 * Settings, the sheets above the chats. The tab bar's badge used to be the only
 * sign of a blocked agent while one of those was open; the count beside Done
 * is that sign again, on the control that goes back to them. Recomputing it
 * there — polling for it — would be the wrong way to get it: it would double
 * every host's SSH round-trips and quietly defeat the poll-rate preference, to
 * show a number the chats list already knows.
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
