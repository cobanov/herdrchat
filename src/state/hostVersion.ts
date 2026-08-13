import { create } from 'zustand';

/**
 * The herdr version the selected host last reported.
 *
 * Same shape as the tab badge, for the same reason: the chat list already pulls
 * a snapshot every few seconds and the version rides along in it, so publishing
 * what is already in hand costs nothing. Settings polling for it separately
 * would be a second SSH round-trip to learn something the screen behind it knew.
 *
 * Null means "no snapshot has landed yet", which is a different thing from a
 * host that answered without a version field — `versionVerdict` distinguishes
 * the two once a value arrives.
 */
interface HostVersion {
  version: string | null;
  setVersion: (version: string | null) => void;
}

export const useHostVersion = create<HostVersion>((set) => ({
  version: null,
  // Guarded: the chat list recomputes this on every poll, forever, and without
  // this every tick would re-render Settings to draw the same string.
  setVersion: (version) => set((state) => (state.version === version ? state : { version })),
}));
