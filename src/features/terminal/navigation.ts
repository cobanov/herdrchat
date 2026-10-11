import { router } from 'expo-router';
import { Platform } from 'react-native';

import type { TerminalPaneKind } from '@/lib/terminal/command';
import { chatSelectionOf, useChatSelection } from '@/state/chatSelection';

/** What `app/chat/terminal` is opened with. */
export interface TerminalRouteParams {
  /** The pane's connection: a host, or one of its machines (`${hostId}/${machineId}`). */
  connectionId: string;
  paneId: string;
  /** Which attach it takes (`paneKind`): `agent attach` by pane id, or `terminal attach` by terminal id. */
  kind: TerminalPaneKind;
  /** The pane's terminal (the snapshot's `terminal_id`); `''` when the snapshot had none. */
  terminalId: string;
  title: string;
}

/**
 * Opens a pane's terminal. On a phone it is pushed over what opened it: a
 * chat, or the chats. On iPad it is the detail beside the chats, as a chat is
 * (`openChat`), even in a narrow window: it replaces whatever detail was open,
 * and remembers the chat it replaced so its Back brings that chat back. Read
 * from the store here, so a caller (a row, a chat's header) need not know.
 */
export function openTerminal(params: TerminalRouteParams) {
  if (Platform.OS === 'ios' && Platform.isPad) {
    const selection = useChatSelection.getState();
    selection.showTerminal({
      connectionId: params.connectionId,
      paneId: params.paneId,
      terminalId: terminalIdParam(params.terminalId),
      paneKind: params.kind,
      title: params.title,
      from: chatSelectionOf(selection.detail),
    });
    // Also dismiss a sheet or a deep-linked screen above the root chats.
    router.dismissTo('/');
  }
  else router.push({ pathname: '/chat/terminal', params: { ...params } });
}

/** The route's terminal id back as the screen takes it: `''` (none sent) is null. */
export function terminalIdParam(value: string | undefined): string | null {
  return value !== undefined && value !== '' ? value : null;
}
