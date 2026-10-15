import * as SecureStore from 'expo-secure-store';
import { useMemo } from 'react';
import { create } from 'zustand';

import { DemoHost } from '@/lib/demo/host';
import { HerdrClient } from '@/lib/herdr/client';
import { withMachine } from '@/lib/herdr/machine';
import {
  isUnderHost,
  machineConnectionId,
  splitMachineConnectionId,
  type HostMachine,
} from '@/lib/herdr/machines';
import { withSession } from '@/lib/herdr/session';
import type { HerdrTransport } from '@/lib/herdr/transport';
import { MissingCredentialsError, SshHerdrTransport } from '@/lib/herdr/sshTransport';
import { normalizeFingerprint } from '@/lib/hostkey';
import type { SshConfig } from '../../modules/herdr-ssh/src';
import { findEnabledMachine, useHostMachines } from './hostMachines';

/**
 * A saved herdr host. Everything here is non-secret and lives in the local
 * database; the private key or password and the host-key pin live in the
 * keychain, keyed by id.
 */
export interface ServerConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authKind: 'privateKey' | 'password';
  /** Path to the herdr binary if it isn't on the non-interactive PATH. */
  herdrPath: string;
  /**
   * Which herdr session to drive. Empty (or "default") means let herdr resolve
   * it — see `withSession`. A host running more than one session used to be
   * driven blind: we controlled whichever the default resolved to, with nothing
   * saying the others existed.
   */
  sessionName: string;
}

export function newConnection(): ServerConnection {
  return {
    id: `srv-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: '',
    host: '',
    sessionName: '',
    port: 22,
    username: '',
    authKind: 'password',
    herdrPath: 'herdr',
  };
}

// MARK: - Secrets
//
// SecureStore keys must be alphanumeric plus ._-, which the generated ids
// already satisfy. Kept in one place so the two namespaces can't collide.

const secretKey = (id: string) => `herdrchat.secret.${id}`;
const pinKey = (id: string) => `herdrchat.hostkey.${id}`;

// Credentials for a machine on the owner's tailnet: never readable while the
// device is locked, never restored onto a different device.
const keychainOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Keys already moved to `keychainOptions` in this launch. */
const migrated = new Set<string>();

/**
 * Read a secret, moving items written before the accessibility option existed
 * onto it (once per key per launch).
 *
 * Re-saving the value did nothing: when the item exists, expo-secure-store
 * updates only its data (`SecItemUpdate` with `kSecValueData`), so its
 * accessibility never changed (#102). An item's accessibility can only be set
 * when it is added, so it is re-added, in an order that never leaves the secret
 * without a copy: a temporary item first, then the real one deleted and added
 * again, then the temporary one removed. If that is interrupted, the next read
 * finds the temporary copy and finishes the job.
 */
async function loadMigrating(key: string): Promise<string | null> {
  const spare = `${key}.migrating`;
  let value = await SecureStore.getItemAsync(key);
  if (value === null) {
    const recovered = await SecureStore.getItemAsync(spare);
    if (recovered === null) return null;
    value = recovered;
  } else if (migrated.has(key)) {
    return value;
  }
  try {
    await SecureStore.setItemAsync(spare, value, keychainOptions);
    await SecureStore.deleteItemAsync(key);
    await SecureStore.setItemAsync(key, value, keychainOptions);
    await SecureStore.deleteItemAsync(spare);
    migrated.add(key);
  } catch {
    // Housekeeping, not the point of the call: we already hold the value the
    // caller asked for, and the spare copy covers a half-done move. Failing the
    // read would take the host down over an accessibility flag.
  }
  return value;
}

export async function saveSecret(id: string, secret: string): Promise<void> {
  await SecureStore.setItemAsync(secretKey(id), secret, keychainOptions);
}

export async function loadSecret(id: string): Promise<string | null> {
  return loadMigrating(secretKey(id));
}

/**
 * The stored pin, in today's format. Normalising on the way out is the whole
 * migration for pins written before the two platforms agreed on a format — see
 * `normalizeFingerprint`, which says which old forms carry over and which
 * cannot.
 */
export async function loadHostKeyPin(id: string): Promise<string | null> {
  const pin = await loadMigrating(pinKey(id));
  return pin === null ? null : normalizeFingerprint(pin);
}

export async function saveHostKeyPin(id: string, fingerprint: string): Promise<void> {
  // Never pin nothing: an empty fingerprint would store "trust anyone".
  if (fingerprint.length === 0) return;
  await SecureStore.setItemAsync(pinKey(id), normalizeFingerprint(fingerprint), keychainOptions);
}

/**
 * Forget everything secret about a server. Called on delete, on full reset,
 * and from the editor's explicit "Trust the new key" recovery — never on an
 * ordinary save, which would silently re-open the trust-on-first-use window.
 */
export async function clearSecrets(id: string, { keepSecret = false } = {}): Promise<void> {
  if (!keepSecret) {
    await SecureStore.deleteItemAsync(secretKey(id));
    await SecureStore.deleteItemAsync(`${secretKey(id)}.migrating`);
  }
  await SecureStore.deleteItemAsync(pinKey(id));
  await SecureStore.deleteItemAsync(`${pinKey(id)}.migrating`);
}

// MARK: - Store

interface ConnectionsState {
  connections: ServerConnection[];
  selectedId: string | null;
  hydrated: boolean;
  setAll: (connections: ServerConnection[], selectedId: string | null) => void;
  select: (id: string | null) => void;
  upsert: (connection: ServerConnection) => void;
  remove: (id: string) => void;
}

export const useConnections = create<ConnectionsState>((set) => ({
  connections: [],
  selectedId: null,
  hydrated: false,
  setAll: (connections, selectedId) => {
    // The demo is appended rather than stored: it exists for every install,
    // survives a reset, and never occupies a row in SQLite. Last, so it never
    // displaces a real host someone added.
    const all = [...connections, demoConnection()];
    // A remembered id that is no longer in the list (its host was deleted) is
    // treated as nothing remembered. Accepting it left Chats saying "No hosts
    // yet" while other hosts and the demo were right there (#90).
    const remembered = selectedId !== null && all.some((connection) => connection.id === selectedId);
    set({
      connections: all,
      // With no hosts and nothing remembered, the demo is the selection. An
      // empty chat list explains nothing; a working conversation explains the
      // whole app, and is also the only thing an App Review device can reach.
      selectedId: remembered ? selectedId : connections[0]?.id ?? DEMO_CONNECTION_ID,
      hydrated: true,
    });
  },
  select: (id) => set({ selectedId: id }),
  upsert: (connection) =>
    set((state) => {
      const index = state.connections.findIndex((existing) => existing.id === connection.id);
      // A new host goes before the Demo, which stays last (see setAll): it
      // landed after it, between the user's own hosts (#4 acceptance).
      const withoutDemo = state.connections.filter((existing) => !isDemo(existing.id));
      const demo = state.connections.filter((existing) => isDemo(existing.id));
      const connections =
        index >= 0
          ? state.connections.map((existing) => (existing.id === connection.id ? connection : existing))
          : [...withoutDemo, connection, ...demo];
      return { connections, selectedId: connection.id };
    }),
  remove: (id) =>
    set((state) => {
      const connections = state.connections.filter((existing) => existing.id !== id);
      return {
        connections,
        selectedId:
          state.selectedId === id ? (connections[0]?.id ?? DEMO_CONNECTION_ID) : state.selectedId,
      };
    }),
}));

/** The selected HOST. A machine is never selected: its chats are in its host's list. */
export function useSelectedConnection(): ServerConnection | null {
  return useConnections(
    (state) => state.connections.find((connection) => connection.id === state.selectedId) ?? null
  );
}

// MARK: - Machines

/**
 * A machine saved on a host (`herdr machine add`), as a connection of its own.
 *
 * Derived, never saved by the person: its id is `${hostId}/${machineId}`
 * (`machineConnectionId`), so everything keyed by connection id (the thread
 * cache, tail cursors, reads, drafts, pins, mutes) works unchanged, and its
 * client reaches it through the host (`withMachine`).
 */
export interface MachineConnection {
  kind: 'machine';
  id: string;
  /** The machine's label in herdr ("klaw"). */
  name: string;
  /** The id of the host it is reached through. */
  via: string;
  /** That host, as saved, for its transport and its name. */
  host: ServerConnection;
  machine: HostMachine;
}

/** Anything a chat can be on: a saved host, the Demo, or a machine of either. */
export type Connection = ServerConnection | MachineConnection;

export function isMachineConnection(connection: Connection): connection is MachineConnection {
  return 'kind' in connection && connection.kind === 'machine';
}

export function machineConnection(host: ServerConnection, machine: HostMachine): MachineConnection {
  return {
    kind: 'machine',
    id: machineConnectionId(host.id, machine.id),
    name: machine.label,
    via: host.id,
    host,
    machine,
  };
}

/**
 * What a connection id names right now: a saved host or the Demo, or, for an
 * id with a slash, an enabled machine its host last listed. Null for anything
 * else — a removed host, or a machine the host no longer lists or has
 * disabled, whose chats are not shown either.
 */
export function resolveConnection(id: string): Connection | null {
  const split = splitMachineConnectionId(id);
  const hostId = split?.hostId ?? id;
  const host = useConnections.getState().connections.find((connection) => connection.id === hostId) ?? null;
  if (host === null || split === null) return host;
  const machine = findEnabledMachine(useHostMachines.getState().byHost, split.hostId, split.machineId);
  return machine === null ? null : machineConnection(host, machine);
}

/**
 * `resolveConnection` as a hook: the connection a screen was opened for (a
 * thread's `connectionId` param), kept current as hosts and their machine
 * lists change. Stable while neither the host nor the machine changes, so a
 * `useMemo(() => clientFor(connection))` does not churn.
 */
export function useConnectionFor(id: string | null | undefined): Connection | null {
  const split = id === null || id === undefined ? null : splitMachineConnectionId(id);
  const hostId = split?.hostId ?? id ?? null;
  const machineId = split?.machineId ?? null;
  const host = useConnections(
    (state) => (hostId === null ? null : state.connections.find((connection) => connection.id === hostId) ?? null)
  );
  const machine = useHostMachines((state) =>
    hostId === null || machineId === null ? null : findEnabledMachine(state.byHost, hostId, machineId)
  );
  return useMemo(() => {
    if (host === null) return null;
    if (machineId === null) return host;
    return machine === null ? null : machineConnection(host, machine);
  }, [host, machine, machineId]);
}

// MARK: - Clients
//
// One long-lived client (and therefore one reused SSH connection) per host,
// shared by the chat list and every thread, so navigating never reconnects.

interface CachedClient {
  client: HerdrClient;
  /** The socket to close, which only a host's own entry owns. */
  transport: SshHerdrTransport | null;
  /**
   * What the host's commands go through before the session is bound: what a
   * machine's client jumps through. The Demo's is its `DemoHost`, so the
   * machine shares the host's fictional state.
   */
  raw: HerdrTransport;
  /** For a machine: what it was built from, so a changed target or session rebuilds it. */
  shape: string | null;
}

const clients = new Map<string, CachedClient>();

/**
 * The reserved id of the host that isn't one.
 *
 * A real connection in every respect the app cares about — it is selected,
 * listed and opened by the same code as any other — except that its transport
 * answers from fixtures instead of a socket. That is deliberate: a separate
 * "demo screen" would be a second implementation of the app, free to drift from
 * the one people actually use.
 */
export const DEMO_CONNECTION_ID = 'demo';

/** The demo's entry in the host list. Never persisted; never holds a secret. */
export function demoConnection(): ServerConnection {
  return {
    id: DEMO_CONNECTION_ID,
    name: 'Demo',
    host: 'demo.local',
    port: 22,
    username: 'demo',
    authKind: 'password',
    herdrPath: 'herdr',
    sessionName: '',
  };
}

export const isDemo = (id: string): boolean => id === DEMO_CONNECTION_ID;

/**
 * Synchronous on purpose: the keychain reads it needs are deferred into the
 * transport, so a screen can build its client with `useMemo` rather than an
 * effect that sets state on resolution.
 */
export function clientFor(connection: Connection): HerdrClient {
  if (isMachineConnection(connection)) return machineClientFor(connection);
  const existing = clients.get(connection.id);
  if (existing !== undefined) return existing.client;

  if (isDemo(connection.id)) {
    // No session wrapper and no keychain: there is no host to address, and a
    // demo that could hold a secret would be a demo worth attacking.
    const demo = new DemoHost();
    const client = new HerdrClient(demo);
    clients.set(connection.id, { client, transport: null, raw: demo, shape: null });
    return client;
  }

  const transport = new SshHerdrTransport(
    connection.id,
    async () => {
      const [secret, pin] = await Promise.all([
        loadSecret(connection.id),
        loadHostKeyPin(connection.id),
      ]);
      if (secret === null || secret.length === 0) {
        throw new MissingCredentialsError(
          connection.authKind === 'password'
            ? `The password for ${connection.name || connection.host} isn't on this device. Restoring a backup brings back hosts but not their passwords. Enter it again.`
            : `The private key for ${connection.name || connection.host} isn't on this device. Restoring a backup brings back hosts but not their keys. Add it again.`
        );
      }
      return sshConfig(connection, secret, pin);
    },
    (fingerprint) => {
      // First contact: remember what we trusted, so a later key change is
      // detectable rather than silently accepted.
      return saveHostKeyPin(connection.id, fingerprint);
    }
  );
  // Bound here and nowhere else: everything that reaches the host — the client,
  // the transcript store, push registration — goes through this transport, so a
  // future call site cannot forget the session because it never has to know.
  const client = new HerdrClient(withSession(transport, connection.sessionName), connection.herdrPath);
  clients.set(connection.id, { client, transport, raw: transport, shape: null });
  return client;
}

/**
 * A machine's client: the host's own transport (one SSH connection for the
 * host and all its machines), jumped to the machine, then bound to the
 * machine's session — in that order, so `HERDR_SESSION` is exported on the
 * machine, where its herdr runs. Cached under the machine's id and dropped
 * with the host's (`invalidateClient`).
 *
 * `herdr` by name, not the host's `herdrPath`: that path is where herdr is on
 * the host, and the machine is another computer. `withPath` covers the usual
 * install places on the machine as it does on a host.
 */
function machineClientFor(connection: MachineConnection): HerdrClient {
  const { host, machine } = connection;
  const shape = [machine.target, machine.session, host.name, machine.label].join('\n');
  const existing = clients.get(connection.id);
  if (existing !== undefined && existing.shape === shape) return existing.client;

  // Built first: the machine rides on the host's transport, made there.
  clientFor(host);
  const hostEntry = clients.get(host.id);
  if (hostEntry === undefined) throw new Error(`No client for ${host.id}`);
  const names = { host: host.name || host.host, machine: machine.label };
  const jumped = withMachine(hostEntry.raw, machine.target, names);
  const client = new HerdrClient(withSession(jumped, machine.session), MACHINE_HERDR_PATH, names);
  clients.set(connection.id, { client, transport: null, raw: jumped, shape });
  return client;
}

const MACHINE_HERDR_PATH = 'herdr';

/** A host's SSH transport, once its client is built. Null for a machine, which has none of its own. */
export function transportFor(id: string): SshHerdrTransport | null {
  return clients.get(id)?.transport ?? null;
}

/**
 * Drop and close a host's cached client — after an edit or a delete — and its
 * machines' with it: they ride on the transport being closed, and an edited
 * host may now reach different machines, or the same ones as someone else.
 */
export async function invalidateClient(id: string): Promise<void> {
  for (const key of [...clients.keys()]) {
    if (isUnderHost(key, id)) clients.delete(key);
  }
  const entry = clients.get(id);
  if (entry === undefined) return;
  clients.delete(id);
  // The demo has no socket to close; dropping the client is the whole teardown,
  // and it takes the fictional conversation with it. A machine has none of its
  // own either: its commands ran on the host's.
  await entry.transport?.close();
}

export function sshConfig(
  connection: ServerConnection,
  secret: string,
  hostKeyFingerprint: string | null
): SshConfig {
  return {
    host: connection.host,
    port: connection.port,
    username: connection.username,
    auth:
      connection.authKind === 'password'
        ? { kind: 'password', password: secret }
        : { kind: 'privateKey', pem: secret, passphrase: null },
    hostKeyFingerprint,
  };
}

/**
 * A throwaway client for the pre-save connection test, built from in-progress
 * form values. Uses its own id so a failed test can't poison the saved host's
 * live connection.
 */
export function testClient(
  connection: ServerConnection,
  secret: string,
  herdrPath: string,
  {
    enforceStoredPin = false,
    onFingerprint,
  }: {
    /**
     * True when editing an existing host whose endpoint is unchanged: the
     * stored pin is still the host's identity, and the test presents real
     * credentials — they must only ever reach the key we pinned. A new or
     * moved host has no pin to hold it to, so first contact is trusted.
     */
    enforceStoredPin?: boolean;
    /** The fingerprint the native layer accepted, for the caller to persist on save. */
    onFingerprint?: (fingerprint: string) => void;
  } = {}
): { client: HerdrClient; dispose: () => Promise<void> } {
  const id = `test-${connection.id}`;
  const transport = new SshHerdrTransport(
    id,
    async () => {
      const pin = enforceStoredPin ? await loadHostKeyPin(connection.id) : null;
      return sshConfig(connection, secret, pin);
    },
    onFingerprint
  );
  return {
    // Bound to the session being tested, like every saved host's client. Without
    // it the test asked the host's DEFAULT session and reported that one's
    // herdr version, whatever the form said (#4 acceptance).
    client: new HerdrClient(withSession(transport, connection.sessionName), herdrPath),
    dispose: () => transport.close(),
  };
}
