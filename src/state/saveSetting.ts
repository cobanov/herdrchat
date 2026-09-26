import type * as SQLite from 'expo-sqlite';

import { setSetting } from './db';
import { encodeBool, useSettings, type Settings } from './settings';

/**
 * Change a setting and persist it, so the table never drifts from the store.
 * One path for every screen that offers a setting: Settings itself, and the
 * thread header's tool-call switch.
 */
export function saveSetting<K extends keyof Settings>(
  db: SQLite.SQLiteDatabase,
  key: K,
  value: Settings[K]
): void {
  useSettings.getState().set(key, value);
  void setSetting(db, key, typeof value === 'boolean' ? encodeBool(value) : String(value));
}
