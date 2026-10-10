import type * as SQLite from 'expo-sqlite';
import { create } from 'zustand';

import type { HerdrTransport } from '@/lib/herdr/transport';
import {
  applyScan,
  deserializeCatalogueCache,
  emptyCatalogueCache,
  scanSlashCommands,
  serializeCatalogueCache,
  type SlashCatalogueCache,
} from '@/lib/slashCommands';
import { SLASH_COMMANDS_KEY_PREFIX, deleteSetting, loadSlashCommandRows, setSetting, slashCommandsKey } from './db';

/**
 * Each connection's slash-command catalogue, as its scans last found it: what
 * the composer's `/` palette offers (`useSlashCommands`).
 *
 * A connection with no entry has not been scanned yet; the palette then offers
 * the static built-ins. A host and each of its machines (`<hostId>/<machineId>`)
 * have entries of their own: a machine has its own Claude Code and its own
 * home folder.
 */
interface SlashCataloguesState {
  byConnection: Readonly<Record<string, SlashCatalogueCache>>;
  set: (connectionId: string, cache: SlashCatalogueCache) => void;
  /** Forget a host's catalogue and its machines'. */
  clear: (hostId: string) => void;
  /**
   * The launch, from the settings table. A connection scanned before the
   * table was read keeps what the scan found, which is newer.
   */
  hydrate: (all: Record<string, SlashCatalogueCache>) => void;
}

/**
 * Bumped by `clear`, so a scan in flight for a removed host, or one of its
 * machines, drops its answer. Kept per host: a machine's scan may be in flight
 * before its connection has an entry to find.
 */
const generations = new Map<string, number>();
const hostOf = (connectionId: string) => connectionId.split('/')[0] ?? connectionId;
const generationOf = (connectionId: string) => generations.get(hostOf(connectionId)) ?? 0;

/** True while `hydrate` runs, which the mirror below must not echo to the table. */
let hydrating = false;

/** The connection itself, or one of its machines. */
const belongsTo = (connectionId: string, hostId: string) =>
  connectionId === hostId || connectionId.startsWith(`${hostId}/`);

export const useSlashCatalogues = create<SlashCataloguesState>((setState) => ({
  byConnection: {},
  set: (connectionId, cache) =>
    setState((state) => ({ byConnection: { ...state.byConnection, [connectionId]: cache } })),
  clear: (hostId) => {
    generations.set(hostOf(hostId), generationOf(hostId) + 1);
    setState((state) => {
      if (!Object.keys(state.byConnection).some((id) => belongsTo(id, hostId))) return state;
      const rest: Record<string, SlashCatalogueCache> = {};
      for (const [id, cache] of Object.entries(state.byConnection)) {
        if (!belongsTo(id, hostId)) rest[id] = cache;
      }
      return { byConnection: rest };
    });
  },
  hydrate: (all) => {
    hydrating = true;
    try {
      setState((state) => ({ byConnection: { ...all, ...state.byConnection } }));
    } finally {
      hydrating = false;
    }
  },
}));

// MARK: - Persistence

/**
 * Read every stored catalogue into the store, so the palette is complete at
 * launch rather than after the first scan. A row this app cannot read (another
 * version's, a corrupt one) is a connection never scanned.
 */
export async function loadSlashCatalogues(db: SQLite.SQLiteDatabase): Promise<void> {
  const rows = await loadSlashCommandRows(db);
  const all: Record<string, SlashCatalogueCache> = {};
  for (const { key, value } of rows) {
    const cache = deserializeCatalogueCache(value);
    if (cache !== null) all[key.slice(SLASH_COMMANDS_KEY_PREFIX.length)] = cache;
  }
  useSlashCatalogues.getState().hydrate(all);
}

/**
 * Keep the settings table in step with the store from now on. Returns the
 * unsubscribe. A mirror, as for host themes, so a scan never needs the
 * database in hand.
 */
export function mirrorSlashCatalogues(db: SQLite.SQLiteDatabase): () => void {
  return useSlashCatalogues.subscribe((next, previous) => {
    if (hydrating || next.byConnection === previous.byConnection) return;
    for (const [connectionId, cache] of Object.entries(next.byConnection)) {
      if (previous.byConnection[connectionId] === cache) continue;
      void setSetting(db, slashCommandsKey(connectionId), serializeCatalogueCache(cache)).catch(() => undefined);
    }
    for (const connectionId of Object.keys(previous.byConnection)) {
      if (connectionId in next.byConnection) continue;
      void deleteSetting(db, slashCommandsKey(connectionId)).catch(() => undefined);
    }
  });
}

// MARK: - Scanning

/** What a scan should read: the host-wide part, and which project folders. */
export interface SlashScanAsk {
  host: boolean;
  cwds: readonly string[];
}

interface Queued {
  host: boolean;
  cwds: Set<string>;
  transport: HerdrTransport;
  done: (() => void)[];
}

/** Asks waiting for the scan in flight to finish, merged, per connection. */
const queued = new Map<string, Queued>();
/** Connections with a scan in flight. */
const running = new Set<string>();

/**
 * Scan a connection's catalogue and store what comes back. Resolves when the
 * scan that covers the ask has finished, whether it worked or not; never
 * rejects. A failed scan keeps the catalogue the store has, and is never
 * shown: the palette is a convenience, and the next due poll tries again.
 *
 * Never two at once per connection: the client serialises its commands, so a
 * second scan would only queue more in front of a send or a transcript read
 * (the reverted b704ec8's failure). An ask that arrives while one runs is
 * merged with any other waiting, and the merge runs once, after it.
 */
export function scanSlashCatalogue(
  connectionId: string,
  transport: HerdrTransport,
  ask: SlashScanAsk
): Promise<void> {
  if (!ask.host && ask.cwds.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const entry = queued.get(connectionId) ?? { host: false, cwds: new Set<string>(), transport, done: [] };
    entry.host = entry.host || ask.host;
    for (const cwd of ask.cwds) entry.cwds.add(cwd);
    // The newest: a connection whose client was rebuilt scans through the new one.
    entry.transport = transport;
    entry.done.push(resolve);
    queued.set(connectionId, entry);
    if (!running.has(connectionId)) void drain(connectionId);
  });
}

async function drain(connectionId: string): Promise<void> {
  running.add(connectionId);
  try {
    for (let entry = queued.get(connectionId); entry !== undefined; entry = queued.get(connectionId)) {
      queued.delete(connectionId);
      // Taken now: a removal while the host answers must void the answer.
      const generation = generationOf(connectionId);
      const held = useSlashCatalogues.getState().byConnection[connectionId];
      const result = await scanSlashCommands(entry.transport, {
        host: entry.host,
        cwds: [...entry.cwds],
        // The binary already read, so an unchanged one is not grepped again.
        knownBinary: held?.binary ?? null,
      });
      if (result !== null && generationOf(connectionId) === generation) {
        const current = useSlashCatalogues.getState().byConnection[connectionId] ?? emptyCatalogueCache();
        useSlashCatalogues.getState().set(connectionId, applyScan(current, result, Date.now()));
      }
      for (const done of entry.done) done();
    }
  } finally {
    running.delete(connectionId);
  }
}

/** For tests: forget what this session did, as a relaunch would. */
export function resetSlashCataloguesSession(): void {
  generations.clear();
  queued.clear();
  running.clear();
  useSlashCatalogues.setState({ byConnection: {} });
}
