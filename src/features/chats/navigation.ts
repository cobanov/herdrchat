import { router } from 'expo-router';
import { Platform } from 'react-native';
import { useChatSelection } from '@/state/chatSelection';

/**
 * Back to the chats, the root, closing whatever is above them: one sheet
 * (Hosts, Settings), two (Settings then Hosts), or a chat pushed on a phone.
 *
 * `dismissTo`, not `navigate('/')`: with a sheet open, `navigate` pushed a
 * second chats screen above it rather than returning to the one underneath.
 * With the chats already on top it changes nothing on screen: Expo Router's
 * `POP_TO` finds that the focused route is the one named and keeps the stack
 * as it is (`StackRouter`, `case 'POP_TO'`). With the chats not in history at
 * all (a cold link straight to a sheet) it replaces the sheet with them.
 */
export function returnToChats() {
  router.dismissTo('/');
}

/**
 * Opens a chat: the workspace's, or with `paneId` the one agent in that pane.
 * iPad selects a detail inside Chats, even in a narrow multitasking window,
 * in place of whatever detail was there (another chat, or a pane's terminal).
 *
 * Either way the chats come to the top first. A phone pushing the chat while a
 * sheet was open put it UNDER the sheet (react-native-screens places a push
 * that follows a modal beneath the modal), so a notification tapped in Hosts
 * or Settings looked like it did nothing until Done. Both actions go through
 * Expo Router's routing queue and are dispatched in one run, so the stack goes
 * from "chats, sheet" to "chats, chat" in one change.
 */
export function openChat(connectionId: string, workspaceId: string, title?: string, paneId?: string, sig?: string | null) {
  // No `paneId` key at all for the workspace chat, so its params are exactly
  // what they were before panes had chats of their own. `sig`, the session the
  // list saw, only from the list: it opens the chat from its cache at once.
  const params = {
    connectionId, workspaceId, title: title ?? '', ...(paneId ? { paneId } : {}), ...(sig ? { sig } : {}),
  };
  if (Platform.OS === 'ios' && Platform.isPad) {
    // Replacing a sheet or legacy deep-link screen with another root would
    // leave two in history, so the selection changes under the root instead.
    useChatSelection.getState().select(params);
    returnToChats();
    return;
  }
  returnToChats();
  router.push({ pathname: '/chat/[workspaceId]', params });
}
