import type * as SQLite from 'expo-sqlite';
import { create } from 'zustand';

import type { HerdrTransport } from '@/lib/herdr/transport';
import { bootstrapHostTheme, fetchHostTheme } from '@/lib/theme/hostThemeClient';
import { deserializeThemeFile, serializeThemeFile } from '@/lib/theme/hostTheme';
import { resolveHostTheme, type HostThemeFile, type ResolvedHostTheme } from '@/lib/theme/resolve';
import { darkPalette, lightPalette } from '@/theme/tokens';
import { useHostMachines } from './hostMachines';
import { HOST_THEME_KEY_PREFIX, clearConnectionSettings, deleteSetting, hostThemeKey, loadHostThemeRows, setSetting } from './db';

/**
 * Each host's theme.json, as the app last saw it, resolved against the app's
 * own palettes. `AppTheme` reads the selected host's entry.
 *
 * A host with no entry has not been checked yet and renders the default
 * theme, the same as a host whose file is missing. The difference matters only
 * to the next check: an entry carries the mtime that lets the host answer
 * "unchanged" in a few bytes.
 */
interface HostThemeState {
  byConnection: Record<string, ResolvedHostTheme>;
  set: (connectionId: string, theme: ResolvedHostTheme) => void;
  clear: (connectionId: string) => void;
  /**
   * The launch, from the settings table. A host checked before the table was
   * read keeps what the check found, which is newer.
   */
  hydrate: (all: Record<string, ResolvedHostTheme>) => void;
}

/** Bumped by `clear`, so a check in flight for a removed host drops its answer. */
const generations = new Map<string, number>();
const generationOf = (connectionId: string) => generations.get(connectionId) ?? 0;

/** True while `hydrate` runs, which the mirror below must not echo to the table. */
let hydrating = false;

export const useHostTheme = create<HostThemeState>((setState) => ({
  byConnection: {},
  set: (connectionId, theme) =>
    setState((state) => ({ byConnection: { ...state.byConnection, [connectionId]: theme } })),
  clear: (connectionId) => {
    // Bumped first, so a check already on its way back for this host drops
    // its answer instead of re-creating the entry (and its settings row)
    // for a host that was just removed.
    generations.set(connectionId, generationOf(connectionId) + 1);
    setState((state) => {
      if (!(connectionId in state.byConnection)) return state;
      const { [connectionId]: _removed, ...rest } = state.byConnection;
      return { byConnection: rest };
    });
  },
  hydrate: (all) => {
    // Not written back: these rows are what the table already holds.
    hydrating = true;
    try {
      setState((state) => ({ byConnection: { ...all, ...state.byConnection } }));
    } finally {
      hydrating = false;
    }
  },
}));

/** Against the app's palettes: the only base a host theme is ever laid over. */
export function resolveFile(file: HostThemeFile): ResolvedHostTheme {
  return resolveHostTheme(file, { light: lightPalette, dark: darkPalette });
}

/** The file a resolved theme was made from, for the next check and for storage. */
export function fileOf(theme: ResolvedHostTheme | undefined): HostThemeFile {
  if (theme === undefined || theme.status === 'missing') return { kind: 'missing' };
  if (theme.status === 'unreadable') return { kind: 'unreadable', mtime: theme.mtime ?? 0 };
  return { kind: 'present', mtime: theme.mtime ?? 0, text: theme.raw ?? '' };
}

// MARK: - Persistence

/**
 * Read every stored host theme and put it in the store. Stored as the raw file
 * and its mtime, not as the resolved overrides: resolving is cheap, and a
 * newer app that resolves differently (a new palette key, a changed accent
 * rule) then applies to a theme cached by an older one.
 */
export async function loadHostThemes(db: SQLite.SQLiteDatabase): Promise<void> {
  const rows = await loadHostThemeRows(db);
  const all: Record<string, ResolvedHostTheme> = {};
  for (const { key, value } of rows) {
    const file = deserializeThemeFile(value);
    // A row the app cannot read is a host never checked, not a broken theme.
    if (file === null) continue;
    all[key.slice(HOST_THEME_KEY_PREFIX.length)] = resolveFile(file);
  }
  useHostTheme.getState().hydrate(all);
}

/**
 * Keep the settings table in step with the store from now on. Returns the
 * unsubscribe. The launch's own hydrate is skipped: those rows came from the
 * table.
 *
 * A mirror rather than a write at each `set` so every path that changes a
 * theme (the poll, Reload, Reset) is persisted by the same few lines, and none
 * of them needs the database in hand.
 */
export function mirrorHostThemes(db: SQLite.SQLiteDatabase): () => void {
  return useHostTheme.subscribe((next, previous) => {
    if (hydrating || next.byConnection === previous.byConnection) return;
    for (const [connectionId, theme] of Object.entries(next.byConnection)) {
      if (previous.byConnection[connectionId] === theme) continue;
      void setSetting(db, hostThemeKey(connectionId), serializeThemeFile(fileOf(theme))).catch(() => undefined);
    }
    for (const connectionId of Object.keys(previous.byConnection)) {
      if (connectionId in next.byConnection) continue;
      void deleteSetting(db, hostThemeKey(connectionId)).catch(() => undefined);
    }
  });
}

/**
 * Forget a host's settings: its rows in the table (the cached theme and
 * machine list among them, as `hostTheme.<id>` and `hostMachines.<id>`, and
 * those of its machines' chats) and its theme and machines in memory. Removing a host and
 * erasing the app both come through here, because clearing only the rows left
 * the host's colours on screen until the next launch, and a host re-added
 * under the same id opened in them.
 */
export async function clearHostSettings(db: SQLite.SQLiteDatabase, connectionId: string): Promise<void> {
  await clearConnectionSettings(db, connectionId);
  useHostTheme.getState().clear(connectionId);
  // Or the removed host's machine chats stayed listed, and resolvable, until
  // the next launch.
  useHostMachines.getState().clear(connectionId);
}

// MARK: - Checking the host


/** Hosts whose reference files were written this session. */
const bootstrapped = new Set<string>();

/** The check in flight per host, so two callers share one round-trip. */
const inFlight = new Map<string, Promise<boolean>>();

/**
 * Ask a host for its theme and store what comes back. True when the host
 * answered; false is a failed check, which changes nothing and is never shown
 * (the next poll tries again).
 *
 * The first check that works on a host in a session also writes the
 * schema, README and example next to theme.json, so an agent asked to restyle
 * the app finds them. The command never overwrites, so running it once per
 * launch also puts back any of the three that someone deleted.
 *
 * A forced check (Reload theme, after Reset) asks for the contents whatever
 * the mtime, and waits out an unforced check already running rather than
 * sharing its answer, which may predate what the person just did.
 */
export function checkHostTheme(
  connectionId: string,
  transport: HerdrTransport,
  { force = false }: { force?: boolean } = {}
): Promise<boolean> {
  const running = inFlight.get(connectionId);
  if (running !== undefined && !force) return running;
  // Taken now, not when the round-trip starts: a removal between the two
  // must still void the answer.
  const generation = generationOf(connectionId);
  const check = (running ?? Promise.resolve(true))
    .catch(() => false)
    .then(() => runCheck(connectionId, transport, force, generation))
    .finally(() => {
      if (inFlight.get(connectionId) === check) inFlight.delete(connectionId);
    });
  inFlight.set(connectionId, check);
  return check;
}

async function runCheck(
  connectionId: string,
  transport: HerdrTransport,
  force: boolean,
  generation: number
): Promise<boolean> {
  if (generationOf(connectionId) !== generation) return true;
  const held = useHostTheme.getState().byConnection[connectionId];
  const heldFile = fileOf(held);
  const next = await fetchHostTheme(transport, heldFile, { force });
  if (next === null) return false;
  if (generationOf(connectionId) !== generation) return true;
  // Compared by content as well as identity: a forced fetch of an unchanged
  // file is a new object, and storing it would re-render every screen and
  // rewrite the row for nothing.
  if (held === undefined || !sameFile(next, heldFile)) {
    useHostTheme.getState().set(connectionId, resolveFile(next));
  }
  if (!bootstrapped.has(connectionId) && (await bootstrapHostTheme(transport))) {
    bootstrapped.add(connectionId);
  }
  return true;
}

function sameFile(a: HostThemeFile, b: HostThemeFile): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'missing' || b.kind === 'missing') return true;
  if (a.mtime !== b.mtime) return false;
  return a.kind !== 'present' || b.kind !== 'present' || a.text === b.text;
}

/** For tests: forget what this session did, as a relaunch would. */
export function resetHostThemeSession(): void {
  generations.clear();
  bootstrapped.clear();
  inFlight.clear();
  useHostTheme.setState({ byConnection: {} });
}
