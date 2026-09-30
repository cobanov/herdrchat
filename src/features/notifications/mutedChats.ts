import Constants from 'expo-constants';
import type * as SQLite from 'expo-sqlite';

import { getPushDeviceId } from '@/features/notifications/deviceId';
import { deviceFileId, existingPushToken, uploadPushToken } from '@/features/notifications/push';
import { mutedSessionIds } from '@/lib/chatPrefs';
import { clientFor, isDemo, type ServerConnection } from '@/state/connections';
import { loadChatPrefs } from '@/state/db';
import { useSettings } from '@/state/settings';

/** The muted list for one host, as its watcher reads it. */
export async function mutedForHost(db: SQLite.SQLiteDatabase, connectionId: string): Promise<string[]> {
  return mutedSessionIds((await loadChatPrefs(db, connectionId)).values());
}

/**
 * Tell a host which of its chats this phone has muted.
 *
 * Muting has to happen on the host: a push is shown by iOS before the app
 * can see it, so the app cannot quietly drop one. The list rides in this
 * device's token file, which the watcher re-reads on every poll, so a mute
 * holds from the next notification on.
 *
 * Nothing to do while notifications are off here: there is no token file,
 * and the list is written with the token when they are turned on.
 */
export async function publishMutedChats(db: SQLite.SQLiteDatabase, connection: ServerConnection): Promise<void> {
  if (isDemo(connection.id) || !useSettings.getState().notifications) return;
  const status = await existingPushToken();
  if (status.state !== 'granted') return;
  const id = deviceFileId(await getPushDeviceId(db));
  const bundleId = Constants.expoConfig?.ios?.bundleIdentifier ?? '';
  await uploadPushToken(
    clientFor(connection).transport,
    id,
    status.token,
    bundleId,
    connection.id,
    await mutedForHost(db, connection.id)
  );
}
