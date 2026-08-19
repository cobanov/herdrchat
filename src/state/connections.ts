import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { DemoHost } from '@/lib/demo/host';
import { HerdrClient } from '@/lib/herdr/client';
import { withSession } from '@/lib/herdr/session';
import { SshHerdrTransport } from '@/lib/herdr/sshTransport';
import { normalizeFingerprint } from '@/lib/hostkey';
import type { SshConfig } from '../../modules/herdr-ssh/src';

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

/**
 * Values written before the accessibility option existed migrate on read: the
 * rewrite is idempotent, so no marker tracks whether it already happened.
 */
async function loadMigrating(key: string): Promise<string | null> {
  const value = await SecureStore.getItemAsync(key);
  if (value !== null) {
    try {
      await SecureStore.setItemAsync(key, value, keychainOptions);
    } catch {
      // The rewrite is housekeeping, not the point of the call: we already hold
      // the value the caller asked for. Letting a refused write fail the read
      // would take the host down for the whole session over an accessibility
      // flag, and the next read attempts the migration again anyway.
    }
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
  if (!keepSecret) await SecureStore.deleteItemAsync(secretKey(id));
  await SecureStore.deleteItemAsync(pinKey(id));
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
  setAll: (connections, selectedId) =>
    set({
      // The demo is appended rather than stored: it exists for every install,
      // survives a reset, and never occupies a row in SQLite. Last, so it never
      // displaces a real host someone added.
      connections: [...connections, demoConnection()],
      // With no hosts and nothing remembered, the demo is the selection. An
      // empty chat list explains nothing; a working conversation explains the
      // whole app, and is also the only thing an App Review device can reach.
      selectedId: selectedId ?? connections[0]?.id ?? DEMO_CONNECTION_ID,
      hydrated: true,
    }),
  select: (id) => set({ selectedId: id }),
  upsert: (connection) =>
    set((state) => {
      const index = state.connections.findIndex((existing) => existing.id === connection.id);
      const connections =
        index >= 0
          ? state.connections.map((existing) => (existing.id === connection.id ? connection : existing))
          : [...state.connections, connection];
      return { connections, selectedId: connection.id };
    }),
  remove: (id) =>
    set((state) => {
      const connections = state.connections.filter((existing) => existing.id !== id);
      return {
        connections,
        selectedId: state.selectedId === id ? (connections[0]?.id ?? null) : state.selectedId,
      };
    }),
}));

export function useSelectedConnection(): ServerConnection | null {
  return useConnections(
    (state) => state.connections.find((connection) => connection.id === state.selectedId) ?? null
  );
}

// MARK: - Clients
//
// One long-lived client (and therefore one reused SSH connection) per host,
// shared by the chat list and every thread, so navigating never reconnects.

const clients = new Map<string, { client: HerdrClient; transport: SshHerdrTransport | null }>();

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
export function clientFor(connection: ServerConnection): HerdrClient {
  const existing = clients.get(connection.id);
  if (existing !== undefined) return existing.client;

  if (isDemo(connection.id)) {
    // No session wrapper and no keychain: there is no host to address, and a
    // demo that could hold a secret would be a demo worth attacking.
    const client = new HerdrClient(new DemoHost());
    clients.set(connection.id, { client, transport: null });
    return client;
  }

  const transport = new SshHerdrTransport(
    connection.id,
    async () => {
      const [secret, pin] = await Promise.all([
        loadSecret(connection.id),
        loadHostKeyPin(connection.id),
      ]);
      return sshConfig(connection, secret ?? '', pin);
    },
    (fingerprint) => {
      // First contact: remember what we trusted, so a later key change is
      // detectable rather than silently accepted.
      void saveHostKeyPin(connection.id, fingerprint);
    }
  );
  // Bound here and nowhere else: everything that reaches the host — the client,
  // the transcript store, push registration — goes through this transport, so a
  // future call site cannot forget the session because it never has to know.
  const client = new HerdrClient(withSession(transport, connection.sessionName), connection.herdrPath);
  clients.set(connection.id, { client, transport });
  return client;
}

export function transportFor(id: string): SshHerdrTransport | null {
  return clients.get(id)?.transport ?? null;
}

/** Drop and close a host's cached client — after an edit or a delete. */
export async function invalidateClient(id: string): Promise<void> {
  const entry = clients.get(id);
  if (entry === undefined) return;
  clients.delete(id);
  // The demo has no socket to close; dropping the client is the whole teardown,
  // and it takes the fictional conversation with it.
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
    client: new HerdrClient(transport, herdrPath),
    dispose: () => transport.close(),
  };
}
