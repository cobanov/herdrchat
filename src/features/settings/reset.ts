import type * as SQLite from 'expo-sqlite';

import { getPushDeviceId } from '@/features/notifications/deviceId';
import { deviceFileId, removePushToken } from '@/features/notifications/push';
import {
  clearSecrets,
  clientFor,
  DEMO_CONNECTION_ID,
  invalidateClient,
  type ServerConnection,
} from '@/state/connections';
import { SELECTED_KEY } from '@/state/Hydrate';
import {
  clearCachedMessages,
  clearConnectionSettings,
  clearPrompts,
  deleteConnection,
  deleteSetting,
} from '@/state/db';

/**
 * How long erasing waits for hosts to forget this device's push token. A host
 * that is off must not hold the erase up, so the attempt is bounded.
 */
const PUSH_CLEANUP_MS = 4_000;

/**
 * Erase everything this app has stored on the device.
 *
 * There is no account to delete and nothing to log out of — the app holds keys
 * to machines you already own — so this is the honest equivalent: the keychain
 * entries, the hosts, the cached conversations and the prompt history.
 *
 * ORDER MATTERS, and it is the reverse of the intuitive one.
 *
 * Secrets go first, then the database row that points at them. The other way
 * round, a keychain delete that fails after the row is gone leaves a secret
 * nothing references and nothing can ever reach again — invisible, undeletable,
 * and still on the device. Doing it in this order means a failure leaves a host
 * whose key is missing, which is a state the app can already describe: the next
 * connection attempt says the key is gone, and removing the host retries the
 * whole thing.
 *
 * Best-effort per host rather than all-or-nothing. One keychain entry refusing
 * to delete must not strand the other four hosts' data on the device, so each is
 * attempted and the failures are collected and reported.
 */
export async function resetAppData(
  db: SQLite.SQLiteDatabase,
  connections: readonly ServerConnection[]
): Promise<{ remaining: ServerConnection[] }> {
  /**
   * The hosts that did NOT come off, returned rather than just counted.
   *
   * The caller has to put these back in the store. Clearing the list
   * unconditionally would show an empty Hosts screen while their rows are still
   * in the database — so the retry the failure note asks for would have nothing
   * to retry, and the data would sit there invisible until the next launch
   * re-hydrated it.
   */
  const remaining: ServerConnection[] = [];

  // Before the clients close: ask every host to drop this device's push token,
  // or an erased host's watcher kept notifying this phone (#90). In parallel
  // and bounded; an unreachable host is not a reason to keep the user waiting.
  const hosts = connections.filter((connection) => connection.id !== DEMO_CONNECTION_ID);
  if (hosts.length > 0) {
    const deviceId = deviceFileId(await getPushDeviceId(db));
    await Promise.race([
      Promise.allSettled(hosts.map((host) => removePushToken(clientFor(host).transport, deviceId))),
      new Promise((resolve) => setTimeout(resolve, PUSH_CLEANUP_MS)),
    ]);
  }

  for (const connection of connections) {
    try {
      await invalidateClient(connection.id);
      await clearSecrets(connection.id);
      // Prompts are keyed by connection, so they have to go before the row that
      // identifies them — otherwise they are orphaned by exactly the same
      // mechanism the secrets ordering above avoids. They are the user's own
      // words, which is the reason this is offered at all.
      await clearPrompts(db, connection.id);
      await clearConnectionSettings(db, connection.id);
      await deleteConnection(db, connection.id);
    } catch {
      remaining.push(connection);
    }
  }

  // Not keyed by connection, so it runs once and outside the loop — and last,
  // so a host that failed above does not skip it. Cached messages from a host
  // you just erased are the thing you least want left behind.
  await clearCachedMessages(db);
  // The selection and the notifications switch describe hosts that are gone.
  await deleteSetting(db, SELECTED_KEY);
  await deleteSetting(db, 'notifications');

  return { remaining };
}
