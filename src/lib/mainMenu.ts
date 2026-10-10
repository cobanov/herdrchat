import type { SheetAction } from './actionSheet';

/**
 * The app's one menu, behind the "…" in the Chats header.
 *
 * Chats is the app; Hosts and Settings are places you visit and come back from,
 * not peers of it. They used to be two thirds of a tab bar, which put a
 * permanent strip of chrome under every conversation list for screens opened a
 * few times a week. Now they are rows here, presented as sheets above the
 * chats.
 *
 * New chat is listed only when a host is selected: with none there is nowhere
 * to start one, and the "+" beside this menu is hidden for the same reason. A
 * row that opens a screen which can only say "add a host first" is a dead end
 * with an extra tap in front of it.
 *
 * Nothing here is destructive, so `buildSheet` keeps this order as given.
 */
export interface MainMenuHandlers {
  newChat: () => void;
  hosts: () => void;
  settings: () => void;
}

export function mainMenuActions({
  hasConnection,
  ...open
}: { hasConnection: boolean } & MainMenuHandlers): SheetAction[] {
  return [
    ...(hasConnection ? [{ label: 'New chat', onPress: open.newChat }] : []),
    { label: 'Hosts', onPress: open.hosts },
    { label: 'Settings', onPress: open.settings },
  ];
}

/**
 * What the sheet is about. `showActionSheet` wants a title on every sheet, and
 * the one thing this menu acts on is the host the list belongs to.
 */
export function mainMenuTitle(hostName: string | null | undefined): string {
  const name = hostName?.trim() ?? '';
  return name.length > 0 ? name : 'HerdrChat';
}
