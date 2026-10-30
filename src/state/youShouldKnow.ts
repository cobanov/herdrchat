import { create } from 'zustand';

import type { HerdrTransport } from '@/lib/herdr/transport';
import { changeYouShouldKnow, detectYouShouldKnow, yskDetectDue, readYouShouldKnow, type HeldStore } from '@/lib/youShouldKnow/client';
import { parseYskFile, type YskChange, type NoteChat, type YskFile } from '@/lib/youShouldKnow/notes';

/**
 * What each host's "You should know" store says, as the app last read it.
 * Nothing here is persisted: the notes live on the host, and a launch reads it again.
 *
 * A host with no entry has not been looked at; one whose `path` is null was
 * looked at and has no "You should know", and nothing anywhere shows for it.
 */
export interface HostNotes {
  /** The store file detection found, or null: this host has no "You should know". */
  path: string | null;
  /** When detection last answered, for its ten-minute cadence. */
  detectedAt: number | null;
  /** The file's version as last read, sent with the next read and every write. */
  version: string | null;
  /** The file as last read; null when there is none to show (unreadable, too large). */
  file: YskFile | null;
  /** The host's chats that run a Claude session, for finding the one a note is for. */
  chats: NoteChat[];
}

const EMPTY: HostNotes = { path: null, detectedAt: null, version: null, file: null, chats: [] };

interface YouShouldKnowState {
  byConnection: Readonly<Record<string, HostNotes>>;
  update: (connectionId: string, change: (entry: HostNotes) => HostNotes) => void;
  clear: (connectionId: string) => void;
}

/** Bumped by `clear`, so an answer in flight for a removed host is dropped. */
const generations = new Map<string, number>();
const generationOf = (connectionId: string) => generations.get(connectionId) ?? 0;

export const useYouShouldKnow = create<YouShouldKnowState>((setState) => ({
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
export function notesOf(connectionId: string): HostNotes {
  return useYouShouldKnow.getState().byConnection[connectionId] ?? EMPTY;
}

const sameChats = (a: readonly NoteChat[], b: readonly NoteChat[]) =>
  a.length === b.length &&
  a.every((chat, index) => {
    const other = b[index];
    return other !== undefined && chat.sessionId === other.sessionId && chat.workspaceId === other.workspaceId && chat.paneId === other.paneId &&
      chat.soleAgent === other.soleAgent && chat.title === other.title;
  });

/** What the chat list's poll saw running on a host. Changes nothing when it is what was held. */
export function setNoteChats(connectionId: string, chats: NoteChat[]): void {
  useYouShouldKnow.getState().update(connectionId, (entry) => (sameChats(entry.chats, chats) ? entry : { ...entry, chats }));
}

/** The store as a write needs it, or null when there is nothing to write to. */
export function heldStore(entry: HostNotes): HeldStore | null {
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
export function checkYouShouldKnow(
  connectionId: string,
  transport: HerdrTransport,
  { detect = false, now = Date.now() }: { detect?: boolean; now?: number } = {}
): Promise<void> {
  const running = inFlight.get(connectionId);
  if (running !== undefined) {
    if (!detect || running.detects) return running.check;
    return running.check.then(() => checkYouShouldKnow(connectionId, transport, { detect: true, now }));
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
  const update = (change: (entry: HostNotes) => HostNotes) => {
    if (live()) useYouShouldKnow.getState().update(connectionId, change);
  };
  let entry = notesOf(connectionId);
  if (detect || yskDetectDue(entry.detectedAt, now)) {
    const found = await detectYouShouldKnow(transport);
    if (found !== null) {
      update((held) =>
        found.kind === 'none'
          ? { ...held, path: null, version: null, file: null, detectedAt: now }
          : found.path === held.path
            ? { ...held, detectedAt: now }
            : { ...held, path: found.path, version: null, file: null, detectedAt: now }
      );
    }
    entry = notesOf(connectionId);
  }
  const path = entry.path;
  const startVersion = entry.version;
  if (path === null || !live()) return;
  const read = await readYouShouldKnow(transport, path, startVersion);
  // A write that landed while the read was out holds a newer version than the
  // file the read saw: what the read says is already old, and dropped.
  const current = (held: HostNotes) => held.path === path && held.version === startVersion;
  if (read === null || read.kind === 'unchanged') return;
  if (read.kind === 'missing') {
    // Gone (the plugin's store removed, or moved): looked for again on the next poll.
    update((held) => (held.path === path ? { ...held, path: null, version: null, file: null, detectedAt: null } : held));
    return;
  }
  if (read.kind === 'unreadable') {
    update((held) => (current(held) ? { ...held, version: read.version, file: null } : held));
    return;
  }
  const file = parseYskFile(read.text);
  // Not JSON (a write caught halfway): keep what was held and read it again next time.
  if (file === null) return;
  update((held) => (current(held) ? { ...held, version: read.version, file } : held));
}

// MARK: - Changing it

/**
 * What a change to a host's store came to: `changed`, written by this call;
 * `unchanged`, nothing to write (the note is gone, or the terminal moved it on);
 * `failed`, not written, which the caller says.
 */
export type HostChange = 'changed' | 'unchanged' | 'failed';

/** One change at a time per host, so two taps never write against the same version. */
const writing = new Map<string, Promise<HostChange>>();

/**
 * Apply a change to a host's store (`changeYouShouldKnow`: compare-and-swap, one
 * retry), and hold the store as it then is.
 */
export function changeHostNotes(connectionId: string, transport: HerdrTransport, change: YskChange): Promise<HostChange> {
  const before = writing.get(connectionId) ?? Promise.resolve<HostChange>('unchanged');
  const next = before.catch(() => 'failed' as const).then(async (): Promise<HostChange> => {
    const generation = generationOf(connectionId);
    const held = heldStore(notesOf(connectionId));
    if (held === null) return 'failed';
    const result = await changeYouShouldKnow(transport, held, change);
    const after = result.held;
    let readMeanwhile = false;
    if (after !== null && generationOf(connectionId) === generation) {
      useYouShouldKnow.getState().update(connectionId, (entry) => {
        if (entry.path !== after.path) return entry;
        readMeanwhile = entry.version !== held.version;
        return { ...entry, version: after.version, file: after.file };
      });
    }
    // A read landed while the write was out, and may have seen a file newer
    // than the one written (the terminal writing right after the swap). Which
    // of the two is newer cannot be told from them: a version is a cksum, with
    // no order. So the host is read again, after any read still out (whose
    // answer is now dropped, its version being gone), and holds what is there.
    // Without it the next 10 s read would fix it, and a write in between is
    // still a compare-and-swap, so nothing would be lost; this only shortens
    // the time the app shows the older file.
    if (readMeanwhile) {
      await (inFlight.get(connectionId)?.check ?? Promise.resolve());
      await checkYouShouldKnow(connectionId, transport);
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
export function resetYouShouldKnowSession(): void {
  generations.clear();
  inFlight.clear();
  writing.clear();
  useYouShouldKnow.setState({ byConnection: {} });
}
