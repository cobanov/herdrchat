import type * as SQLite from 'expo-sqlite';

import { showActionSheet } from '@/components/ActionSheet';
import { DEVICE_ICONS, useDeviceIcons, type DeviceIcon } from '@/state/deviceIcons';

/** What each glyph is called in the sheet that offers it. */
export const DEVICE_ICON_LABELS: Readonly<Record<DeviceIcon, string>> = {
  desktopcomputer: 'Desktop',
  laptopcomputer: 'Laptop',
  macmini: 'Mac mini',
  'server.rack': 'Server',
  display: 'Display',
  cpu: 'Board',
  gamecontroller: 'Game console',
  house: 'Home',
  cloud: 'Cloud',
  terminal: 'Terminal',
};

/** Offer the glyphs for one host, and "No icon" when it has one. */
export function chooseDeviceIcon(db: SQLite.SQLiteDatabase, connectionId: string, name: string): void {
  const current = useDeviceIcons.getState().byConnection[connectionId];
  const set = (icon: DeviceIcon | null) => void useDeviceIcons.getState().set(db, connectionId, icon);
  showActionSheet({
    title: `Icon for ${name}`,
    message: 'Shown on its chats, so a list of several computers says which is which.',
    actions: [
      ...DEVICE_ICONS.map((icon) => ({ label: `${DEVICE_ICON_LABELS[icon]}${icon === current ? ' ✓' : ''}`, onPress: () => set(icon) })),
      ...(current === undefined ? [] : [{ label: 'No icon', destructive: true, onPress: () => set(null) }]),
    ],
  });
}
