import { router } from 'expo-router';
import { Platform } from 'react-native';
import { useChatSelection } from '@/state/chatSelection';

/**
 * Opens a chat: the workspace's, or with `paneId` the one agent in that pane.
 * iPad selects a detail inside Chats, even in a narrow multitasking window.
 */
export function openChat(connectionId: string, workspaceId: string, title?: string, paneId?: string) {
  // No `paneId` key at all for the workspace chat, so its params are exactly
  // what they were before panes had chats of their own.
  const params = { connectionId, workspaceId, title: title ?? '', ...(paneId ? { paneId } : {}) };
  // Also dismiss a sheet or legacy deep-link screen above the root chats.
  // Replacing that screen with another root would leave two in history.
  if (Platform.OS === 'ios' && Platform.isPad) {
    useChatSelection.getState().select(params);
    router.dismissTo('/');
  }
  else router.push({ pathname: '/chat/[workspaceId]', params });
}
