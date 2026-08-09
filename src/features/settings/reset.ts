import type * as SQLite from 'expo-sqlite';

import {
  clearSecrets,
  invalidateClient,
  type ServerConnection,
} from '@/state/connections';
import { clearCachedMessages, clearPrompts, deleteConnection } from '@/state/db';

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
): Promise<{ failed: string[] }> {
  const failed: string[] = [];

  for (const connection of connections) {
    try {
      await invalidateClient(connection.id);
      await clearSecrets(connection.id);
      // Prompts are keyed by connection, so they have to go before the row that
      // identifies them — otherwise they are orphaned by exactly the same
      // mechanism the secrets ordering above avoids. They are the user's own
      // words, which is the reason this is offered at all.
      await clearPrompts(db, connection.id);
      await deleteConnection(db, connection.id);
    } catch {
      failed.push(connection.name.length > 0 ? connection.name : connection.host);
    }
  }

  // Not keyed by connection, so it runs once and outside the loop — and last,
  // so a host that failed above does not skip it. Cached messages from a host
  // you just erased are the thing you least want left behind.
  await clearCachedMessages(db);

  return { failed };
}
