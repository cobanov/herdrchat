import { create } from 'zustand';

/**
 * The herdr version each host last reported, by its connection id.
 *
 * Kept per host: one value for the app showed the host switched away from
 * until the new host's first poll landed (HC-23).
 *
 * Same shape as the attention count (`badge.ts`), for the same reason: the chat list already pulls
 * a snapshot every few seconds and the version rides along in it, so publishing
 * what is already in hand costs nothing. Settings polling for it separately
 * would be a second SSH round-trip to learn something the screen behind it knew.
 *
 * Null means "no snapshot has landed yet", which is a different thing from a
 * host that answered without a version field — `versionVerdict` distinguishes
 * the two once a value arrives.
 */
interface HostVersion {
  versions: Readonly<Record<string, string | null>>;
  setVersion: (connectionId: string, version: string | null) => void;
}

export const useHostVersion = create<HostVersion>((set) => ({
  versions: {},
  // Guarded: the chat list recomputes this on every poll, forever, and without
  // this every tick would re-render Settings to draw the same string.
  setVersion: (connectionId, version) => set((state) => (state.versions[connectionId] === version
    ? state
    : { versions: { ...state.versions, [connectionId]: version } })),
}));

/** The version a host last reported; null before its first poll, or with no host. */
export function hostVersionOf(versions: HostVersion['versions'], connectionId: string | null | undefined): string | null {
  return connectionId == null ? null : versions[connectionId] ?? null;
}
