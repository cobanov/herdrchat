import { router } from 'expo-router';
import { Platform } from 'react-native';
import { useChatSelection } from '@/state/chatSelection';

/** iPad selects a detail inside Chats, even in a narrow multitasking window. */
export function openChat(connectionId: string, workspaceId: string, title?: string) {
  const params = { connectionId, workspaceId, title: title ?? '' };
  // Also dismiss a sheet or legacy deep-link screen above the root chats.
  // Replacing that screen with another root would leave two in history.
  if (Platform.OS === 'ios' && Platform.isPad) {
    useChatSelection.getState().select(params);
    router.dismissTo('/');
  }
  else router.push({ pathname: '/chat/[workspaceId]', params });
}
