import type * as SQLite from 'expo-sqlite';
import { create } from 'zustand';

import type { IconName } from '@/components/Icon';
import { getSetting, setSetting } from './db';

/** The glyphs a host or a machine can be given, to tell their chats apart in one list. */
export const DEVICE_ICONS = [
  'desktopcomputer',
  'laptopcomputer',
  'macmini',
  'server.rack',
  'display',
  'cpu',
  'gamecontroller',
  'house',
  'cloud',
  'terminal',
] as const satisfies readonly IconName[];
export type DeviceIcon = (typeof DEVICE_ICONS)[number];

const KEY = 'deviceIcons';

/** The saved map, by connection id (a host's, or `${hostId}/${machineId}`); anything else is dropped. */
export function parseDeviceIcons(raw: string | null): Record<string, DeviceIcon> {
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, DeviceIcon] => (DEVICE_ICONS as readonly unknown[]).includes(entry[1]))
    );
  } catch {
    return {};
  }
}

interface DeviceIconsState {
  byConnection: Readonly<Record<string, DeviceIcon>>;
  load: (db: SQLite.SQLiteDatabase) => Promise<void>;
  /** Give a connection its glyph, or take it away with null. */
  set: (db: SQLite.SQLiteDatabase, connectionId: string, icon: DeviceIcon | null) => Promise<void>;
}

/**
 * The glyph chosen for each host and machine, on this device only. herdr has
 * no such field, and a machine is configured on its host, not here, so this is
 * the phone's own label for it, as a pin is.
 */
export const useDeviceIcons = create<DeviceIconsState>((setState, getState) => ({
  byConnection: {},
  load: async (db) => {
    setState({ byConnection: parseDeviceIcons(await getSetting(db, KEY)) });
  },
  set: async (db, connectionId, icon) => {
    const { [connectionId]: _old, ...rest } = getState().byConnection;
    const next = icon === null ? rest : { ...rest, [connectionId]: icon };
    setState({ byConnection: next });
    await setSetting(db, KEY, JSON.stringify(next));
  },
}));

/** A connection's glyph, or null when none was chosen. */
export function useDeviceIcon(connectionId: string | null | undefined): DeviceIcon | null {
  return useDeviceIcons((state) => (connectionId == null ? null : state.byConnection[connectionId] ?? null));
}
