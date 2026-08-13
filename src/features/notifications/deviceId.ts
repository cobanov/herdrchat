import type { SQLiteDatabase } from 'expo-sqlite';

import { getSetting, setSetting } from '@/state/db';

/**
 * The stable per-install id that names this device's token file on every host.
 *
 * It used to be seeded from `Constants.sessionId`, which changes on every
 * launch — so each launch wrote a new file, the watcher pushed to all of them
 * (duplicate notifications), and opt-out deleted only the newest. Generated
 * once, persisted in the settings table, reused for the install's lifetime.
 */

const DEVICE_ID_KEY = 'pushDeviceId';

/** 16 hex chars: unique among the handful of devices sharing one token dir. */
const ID_CHUNKS = 4;
const CHUNK_MAX = 0x10000;
const CHUNK_WIDTH = 4;

/**
 * Hex only, so the id is inert in a shell word and survives `deviceFileId`
 * unchanged. `Math.random` is enough here for the same reason it is enough for
 * connection ids (see `newConnection`): this is a name, not a credential.
 */
export function newDeviceId(): string {
  let id = '';
  for (let i = 0; i < ID_CHUNKS; i++) {
    id += Math.floor(Math.random() * CHUNK_MAX)
      .toString(16)
      .padStart(CHUNK_WIDTH, '0');
  }
  return id;
}

/** The install's id, created on first use and stable ever after. */
export async function getPushDeviceId(db: SQLiteDatabase): Promise<string> {
  const existing = await getSetting(db, DEVICE_ID_KEY);
  if (existing !== null && existing.length > 0) return existing;
  const id = newDeviceId();
  await setSetting(db, DEVICE_ID_KEY, id);
  return id;
}
