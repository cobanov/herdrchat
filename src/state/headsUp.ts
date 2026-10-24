import { create } from 'zustand';

import type { HerdrTransport } from '@/lib/herdr/transport';
import { changeHeadsUp, detectHeadsUp, headsUpDetectDue, readHeadsUp, type HeldStore } from '@/lib/headsup/client';
import { parseHeadsUpFile, type HeadsUpChange, type HeadsUpChat, type HeadsUpFile } from '@/lib/headsup/items';

/**
 * What each host's Heads Up store says, as the app last read it. Nothing here
 * is persisted: the list lives on the host, and a launch reads it again.
 *
 * A host with no entry has not been looked at; one whose `path` is null was
 * looked at and has no Heads Up, and nothing anywhere shows for it.
 */
export interface HostHeadsUp {
  /** The store file detection found, or null: this host has no Heads Up. */
  path: string | null;
  /** When detection last answered, for its ten-minute cadence. */
  detectedAt: number | null;
  /** The file's version as last read, sent with the next read and every write. */
  version: string | null;
  /** The file as last read; null when there is none to show (unreadable, too large). */
  file: HeadsUpFile | null;
  /** The host's chats that run a Claude session, for finding the one that raised an item. */
  chats: HeadsUpChat[];
}

const EMPTY: HostHeadsUp = { path: null, detectedAt: null, version: null, file: null, chats: [] };

interface HeadsUpState {
  byConnection: Readonly<Record<string, HostHeadsUp>>;
  update: (connectionId: string, change: (entry: HostHeadsUp) => HostHeadsUp) => void;
  clear: (connectionId: string) => void;
}

/** Bumped by `clear`, so an answer in flight for a removed host is dropped. */
const generations = new Map<string, number>();
const generationOf = (connectionId: string) => generations.get(connectionId) ?? 0;

export const useHeadsUp = create<HeadsUpState>((setState) => ({
  byConnection: {},
  update: (connectionId, change) =>
    setState((state) => {
      const held = state.byConnection[connectionId] ?? EMPTY;
      const next = change(held);
      return next === held ? state : { byConnection: { ...state.byConnection, [connectionId]: next } };
    }),
  clear: (connectionId) => {
    generations.set(connectionId, generationOf(connectionId) + 1);
    setState((state) => {
      if (!(connectionId in state.byConnection)) return state;
      const { [connectionId]: _removed, ...rest } = state.byConnection;
      return { byConnection: rest };
    });
  },
}));

/** The entry for a host, or the empty one. */
export function headsUpOf(connectionId: string): HostHeadsUp {
  return useHeadsUp.getState().byConnection[connectionId] ?? EMPTY;
}

const sameChats = (a: readonly HeadsUpChat[], b: readonly HeadsUpChat[]) =>
  a.length === b.length &&
  a.every((chat, index) => {
    const other = b[index];
    return other !== undefined && chat.sessionId === other.sessionId && chat.workspaceId === other.workspaceId && chat.paneId === other.paneId &&
      chat.soleAgent === other.soleAgent;
  });

/** What the chat list's poll saw running on a host. Changes nothing when it is what was held. */
export function setHeadsUpChats(connectionId: string, chats: HeadsUpChat[]): void {
  useHeadsUp.getState().update(connectionId, (entry) => (sameChats(entry.chats, chats) ? entry : { ...entry, chats }));
}

/** The store as a write needs it, or null when there is nothing to write to. */
export function heldStore(entry: HostHeadsUp): HeldStore | null {
  return entry.path === null || entry.version === null || entry.file === null
    ? null
    : { path: entry.path, version: entry.version, file: entry.file };
}

// MARK: - Checking the host

/** The check in flight per host, so two callers share one round-trip. */
const inFlight = new Map<string, Promise<void>>();

/**
 * Look for the store when that is due (or `detect` asks), then read it when
 * there is one. Never rejects, and a failed step changes nothing: the next
 * poll tries again.
 */
export function checkHeadsUp(
  connectionId: string,
  transport: HerdrTransport,
  { detect = false, now = Date.now() }: { detect?: boolean; now?: number } = {}
): Promise<void> {
  const running = inFlight.get(connectionId);
  if (running !== undefined) return running;
  const generation = generationOf(connectionId);
  const check = runCheck(connectionId, transport, detect, now, generation)
    .catch(() => undefined)
    .finally(() => {
      if (inFlight.get(connectionId) === check) inFlight.delete(connectionId);
    });
  inFlight.set(connectionId, check);
  return check;
}

async function runCheck(connectionId: string, transport: HerdrTransport, detect: boolean, now: number, generation: number): Promise<void> {
  const live = () => generationOf(connectionId) === generation;
  const update = (change: (entry: HostHeadsUp) => HostHeadsUp) => {
    if (live()) useHeadsUp.getState().update(connectionId, change);
  };
  let entry = headsUpOf(connectionId);
  if (detect || headsUpDetectDue(entry.detectedAt, now)) {
    const found = await detectHeadsUp(transport);
    if (found !== null) {
      update((held) =>
        found.kind === 'none'
          ? { ...held, path: null, version: null, file: null, detectedAt: now }
          : found.path === held.path
            ? { ...held, detectedAt: now }
            : { ...held, path: found.path, version: null, file: null, detectedAt: now }
      );
    }
    entry = headsUpOf(connectionId);
  }
  const path = entry.path;
  if (path === null || !live()) return;
  const read = await readHeadsUp(transport, path, entry.version);
  if (read === null || read.kind === 'unchanged') return;
  if (read.kind === 'missing') {
    // Gone (the mod removed, or its store moved): looked for again on the next poll.
    update((held) => (held.path === path ? { ...held, path: null, version: null, file: null, detectedAt: null } : held));
    return;
  }
  if (read.kind === 'unreadable') {
    update((held) => (held.path === path ? { ...held, version: read.version, file: null } : held));
    return;
  }
  const file = parseHeadsUpFile(read.text);
  // Not JSON (a write caught halfway): keep what was held and read it again next time.
  if (file === null) return;
  update((held) => (held.path === path ? { ...held, version: read.version, file } : held));
}

// MARK: - Changing it

/** One change at a time per host, so two taps never write against the same version. */
const writing = new Map<string, Promise<boolean>>();

/**
 * Apply a change to a host's store (`changeHeadsUp`: compare-and-swap, one
 * retry). True when it is done, or there was nothing to do; false when it
 * could not be written, which the caller says.
 */
export function changeHostHeadsUp(connectionId: string, transport: HerdrTransport, change: HeadsUpChange): Promise<boolean> {
  const before = writing.get(connectionId) ?? Promise.resolve(true);
  const next = before.catch(() => true).then(async () => {
    const generation = generationOf(connectionId);
    const held = heldStore(headsUpOf(connectionId));
    if (held === null) return false;
    const result = await changeHeadsUp(transport, held, change);
    const after = result.held;
    if (after !== null && generationOf(connectionId) === generation) {
      useHeadsUp.getState().update(connectionId, (entry) =>
        entry.path === after.path ? { ...entry, version: after.version, file: after.file } : entry
      );
    }
    return result.ok;
  });
  const tracked = next.finally(() => {
    if (writing.get(connectionId) === tracked) writing.delete(connectionId);
  });
  writing.set(connectionId, tracked);
  return tracked;
}

/** For tests: forget everything, as a relaunch would. */
export function resetHeadsUpSession(): void {
  generations.clear();
  inFlight.clear();
  writing.clear();
  useHeadsUp.setState({ byConnection: {} });
}
