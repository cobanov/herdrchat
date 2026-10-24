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

/** The check in flight per host, so two callers share one round-trip, and whether it looks for the store. */
const inFlight = new Map<string, { check: Promise<void>; detects: boolean }>();

/**
 * Look for the store when that is due (or `detect` asks), then read it when
 * there is one. Never rejects, and a failed step changes nothing: the next
 * poll tries again.
 *
 * A caller joins the check in flight, except one asking to look (a pull to
 * refresh) while that check does not: it gets a check that looks, after the
 * running one, so the ask is never dropped.
 */
export function checkHeadsUp(
  connectionId: string,
  transport: HerdrTransport,
  { detect = false, now = Date.now() }: { detect?: boolean; now?: number } = {}
): Promise<void> {
  const running = inFlight.get(connectionId);
  if (running !== undefined) {
    if (!detect || running.detects) return running.check;
    return running.check.then(() => checkHeadsUp(connectionId, transport, { detect: true, now }));
  }
  const generation = generationOf(connectionId);
  const check: Promise<void> = runCheck(connectionId, transport, detect, now, generation)
    .catch(() => undefined)
    .finally(() => {
      if (inFlight.get(connectionId)?.check === check) inFlight.delete(connectionId);
    });
  inFlight.set(connectionId, { check, detects: detect });
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
  const startVersion = entry.version;
  if (path === null || !live()) return;
  const read = await readHeadsUp(transport, path, startVersion);
  // A write that landed while the read was out holds a newer version than the
  // file the read saw: what the read says is already old, and dropped.
  const current = (held: HostHeadsUp) => held.path === path && held.version === startVersion;
  if (read === null || read.kind === 'unchanged') return;
  if (read.kind === 'missing') {
    // Gone (the mod removed, or its store moved): looked for again on the next poll.
    update((held) => (held.path === path ? { ...held, path: null, version: null, file: null, detectedAt: null } : held));
    return;
  }
  if (read.kind === 'unreadable') {
    update((held) => (current(held) ? { ...held, version: read.version, file: null } : held));
    return;
  }
  const file = parseHeadsUpFile(read.text);
  // Not JSON (a write caught halfway): keep what was held and read it again next time.
  if (file === null) return;
  update((held) => (current(held) ? { ...held, version: read.version, file } : held));
}

// MARK: - Changing it

/**
 * What a change to a host's store came to: `changed`, written by this call;
 * `unchanged`, nothing to write (the item was already as asked, or gone);
 * `failed`, not written, which the caller says.
 */
export type HostChange = 'changed' | 'unchanged' | 'failed';

/** One change at a time per host, so two taps never write against the same version. */
const writing = new Map<string, Promise<HostChange>>();

/**
 * Apply a change to a host's store (`changeHeadsUp`: compare-and-swap, one
 * retry), and hold the store as it then is.
 */
export function changeHostHeadsUp(connectionId: string, transport: HerdrTransport, change: HeadsUpChange): Promise<HostChange> {
  const before = writing.get(connectionId) ?? Promise.resolve<HostChange>('unchanged');
  const next = before.catch(() => 'failed' as const).then(async (): Promise<HostChange> => {
    const generation = generationOf(connectionId);
    const held = heldStore(headsUpOf(connectionId));
    if (held === null) return 'failed';
    const result = await changeHeadsUp(transport, held, change);
    const after = result.held;
    if (after !== null && generationOf(connectionId) === generation) {
      useHeadsUp.getState().update(connectionId, (entry) =>
        entry.path === after.path ? { ...entry, version: after.version, file: after.file } : entry
      );
    }
    return !result.ok ? 'failed' : result.changed ? 'changed' : 'unchanged';
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
