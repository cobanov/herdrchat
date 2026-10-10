import type * as SQLite from 'expo-sqlite';
import { create } from 'zustand';

import { parseMachineList, type HostMachine, type MachineList } from '@/lib/herdr/machines';
import { HOST_MACHINES_KEY_PREFIX, deleteSetting, hostMachinesKey, loadHostMachineRows, setSetting } from './db';

/**
 * The machines saved on each host, as the host last listed them.
 *
 * The phone configures none of this: herdr on the host keeps the list
 * (`herdr machine add`), and the chat list's poll asks for it (see
 * `refreshHostMachines`). Disabled machines are kept here, as the host lists
 * them, and left out of what is shown (`enabledMachines`), so re-enabling one
 * at the host brings its chats back without anything else changing.
 *
 * A host with no entry has not been asked yet; a host with an empty list has
 * none, or a herdr too old to have machines.
 */
interface HostMachinesState {
  byHost: Readonly<Record<string, readonly HostMachine[]>>;
  set: (hostId: string, machines: readonly HostMachine[]) => void;
  clear: (hostId: string) => void;
  /**
   * The launch, from the settings table. A host asked before the table was
   * read keeps what the host said, which is newer.
   */
  hydrate: (all: Record<string, readonly HostMachine[]>) => void;
}

/** Bumped by `clear`, so a refresh in flight for a removed host drops its answer. */
const generations = new Map<string, number>();
const generationOf = (hostId: string) => generations.get(hostId) ?? 0;

/** True while `hydrate` runs, which the mirror below must not echo to the table. */
let hydrating = false;

export const useHostMachines = create<HostMachinesState>((setState) => ({
  byHost: {},
  set: (hostId, machines) =>
    setState((state) => {
      const held = state.byHost[hostId];
      const next = keepIdentity(held, machines);
      // Unchanged: no new objects, so nothing that resolved a machine
      // connection from this list re-renders, and the mirror writes nothing.
      if (next === held) return state;
      return { byHost: { ...state.byHost, [hostId]: next } };
    }),
  clear: (hostId) => {
    generations.set(hostId, generationOf(hostId) + 1);
    setState((state) => {
      if (!(hostId in state.byHost)) return state;
      const { [hostId]: _removed, ...rest } = state.byHost;
      return { byHost: rest };
    });
  },
  hydrate: (all) => {
    hydrating = true;
    try {
      setState((state) => ({ byHost: { ...all, ...state.byHost } }));
    } finally {
      hydrating = false;
    }
  },
}));

/**
 * `next`, reusing `held`'s objects wherever a machine is unchanged, and `held`
 * itself when nothing is. The poll parses a fresh list every minute; without
 * this each one would hand every open machine thread a "new" connection.
 */
function keepIdentity(held: readonly HostMachine[] | undefined, next: readonly HostMachine[]): readonly HostMachine[] {
  if (held === undefined) return next;
  const byId = new Map(held.map((machine) => [machine.id, machine]));
  const merged = next.map((machine) => {
    const previous = byId.get(machine.id);
    return previous !== undefined && sameMachine(previous, machine) ? previous : machine;
  });
  const unchanged = merged.length === held.length && merged.every((machine, index) => machine === held[index]);
  return unchanged ? held : merged;
}

function sameMachine(a: HostMachine, b: HostMachine): boolean {
  return a.id === b.id && a.label === b.label && a.target === b.target && a.session === b.session && a.enabled === b.enabled;
}

const NO_MACHINES: readonly HostMachine[] = [];

/** The machines whose chats a host's list shows. */
export function enabledMachines(byHost: HostMachinesState['byHost'], hostId: string): readonly HostMachine[] {
  const all = byHost[hostId];
  if (all === undefined || all.every((machine) => machine.enabled)) return all ?? NO_MACHINES;
  return all.filter((machine) => machine.enabled);
}

/** One enabled machine of a host, or null: gone, disabled, or never listed. */
export function findEnabledMachine(
  byHost: HostMachinesState['byHost'],
  hostId: string,
  machineId: string
): HostMachine | null {
  return byHost[hostId]?.find((machine) => machine.id === machineId && machine.enabled) ?? null;
}

// MARK: - Persistence

/** The stored form: a bare array, which `parseMachineList` reads back. */
export function serializeMachines(machines: readonly HostMachine[]): string {
  return JSON.stringify(machines);
}

/**
 * Read every stored machine list into the store, so a host's machine chats are
 * listed at launch rather than a minute later. Read back through the parser
 * the host's answer goes through, so a row an older app wrote that this one
 * cannot use is skipped like a bad row from the host.
 */
export async function loadHostMachines(db: SQLite.SQLiteDatabase): Promise<void> {
  const rows = await loadHostMachineRows(db);
  const all: Record<string, readonly HostMachine[]> = {};
  for (const { key, value } of rows) {
    let list: MachineList;
    try {
      list = parseMachineList(value);
    } catch {
      // Unreadable: the host is asked again on the first poll.
      continue;
    }
    all[key.slice(HOST_MACHINES_KEY_PREFIX.length)] = list.machines;
  }
  useHostMachines.getState().hydrate(all);
}

/**
 * Keep the settings table in step with the store from now on. Returns the
 * unsubscribe. A mirror, as for host themes (`mirrorHostThemes`), so the poll
 * never needs the database in hand.
 */
export function mirrorHostMachines(db: SQLite.SQLiteDatabase): () => void {
  return useHostMachines.subscribe((next, previous) => {
    if (hydrating || next.byHost === previous.byHost) return;
    for (const [hostId, machines] of Object.entries(next.byHost)) {
      if (previous.byHost[hostId] === machines) continue;
      void setSetting(db, hostMachinesKey(hostId), serializeMachines(machines)).catch(() => undefined);
    }
    for (const hostId of Object.keys(previous.byHost)) {
      if (hostId in next.byHost) continue;
      void deleteSetting(db, hostMachinesKey(hostId)).catch(() => undefined);
    }
  });
}

// MARK: - Asking the host

/** The refresh in flight per host, so two callers share one round-trip. */
const inFlight = new Map<string, Promise<boolean>>();

/**
 * Ask a host for its machines and store what comes back. True when the host
 * answered; false is a failed refresh, which keeps the last list and is never
 * shown (the next due poll tries again). Never rejects.
 *
 * Takes the host's client, not a machine's: a machine's own machines are not
 * listed, so its chats list never federates further than one hop.
 */
export function refreshHostMachines(
  hostId: string,
  client: { machines: () => Promise<MachineList> }
): Promise<boolean> {
  const running = inFlight.get(hostId);
  if (running !== undefined) return running;
  // Taken now: a removal while the host answers must void the answer.
  const generation = generationOf(hostId);
  const refresh = client
    .machines()
    .then(({ machines }) => {
      if (generationOf(hostId) === generation) useHostMachines.getState().set(hostId, machines);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      if (inFlight.get(hostId) === refresh) inFlight.delete(hostId);
    });
  inFlight.set(hostId, refresh);
  return refresh;
}

/** For tests: forget what this session did, as a relaunch would. */
export function resetHostMachinesSession(): void {
  generations.clear();
  inFlight.clear();
  useHostMachines.setState({ byHost: {} });
}
