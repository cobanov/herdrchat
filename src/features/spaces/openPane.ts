import { Keyboard } from 'react-native';

import { openChat } from '@/features/chats/navigation';
import { paneTarget } from '@/features/chats/paneTarget';
import type { ListedChat } from '@/features/chats/listedChat';
import { terminalRowParams } from '@/features/terminal/listRows';
import { openTerminal } from '@/features/terminal/navigation';
import type { LayoutPane } from '@/lib/spaces/layout';

/**
 * Opens what a box in a layout view stands for, after closing the view: an
 * agent's chat (`paneTarget`), or any other pane's terminal, attached exactly
 * as its terminal row attaches it. False for a box with nothing to open (a
 * pane the snapshot listed in a layout but nowhere else).
 */
export function canOpenPane(summary: ListedChat, pane: LayoutPane): boolean {
  return summary.panes.some((item) => item.paneId === pane.paneId) ||
    summary.shellPanes.some((item) => item.paneId === pane.paneId);
}

export function openPane(summary: ListedChat, pane: LayoutPane, close: () => void): void {
  const agent = summary.panes.find((item) => item.paneId === pane.paneId);
  const shell = summary.shellPanes.find((item) => item.paneId === pane.paneId);
  if (agent === undefined && shell === undefined) return;
  Keyboard.dismiss();
  close();
  if (agent !== undefined) {
    const target = paneTarget(summary, agent);
    openChat(summary.connectionId, summary.workspaceId, target.title, target.paneId);
  } else if (shell !== undefined) {
    openTerminal(terminalRowParams(summary.connectionId, shell));
  }
}
