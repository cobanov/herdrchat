import { Keyboard, View } from 'react-native';

import { Text } from '@/components/Text';
import { SwipeableChatRow } from '@/features/chats/SwipeableChatRow';
import type { useChatActions } from '@/features/chats/useChatActions';
import type { useChatPrefs } from '@/features/chats/useChatPrefs';
import { openFor, readsOf, type ListedChat, type OpenChat, type ReadsByConnection } from '@/features/chats/listedChat';
import type { LayoutAnchor } from '@/features/spaces/LayoutPeek';
import { terminalRowParams, type ListItemWithTerminals } from '@/features/terminal/listRows';
import { openTerminal } from '@/features/terminal/navigation';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, spacing } from '@/theme/tokens';

import { agentPrefRow, agentTestKey, isAgentRow, isAgentUnread } from './agentRows';
import { spaceCardMode } from './chatGroups';
import { isChatUnread, isPaneUnread } from './chatUnread';
import { openChat } from './navigation';
import { PaneRow } from './PaneRow';
import { paneTarget } from './paneTarget';
import { rowTitle } from './rowText';
import { TabDivider } from './TabDivider';
import { TerminalRow } from './TerminalRow';

/** What a space card's layout button does: a floating card on iPad, a sheet on a phone. */
export interface LayoutButton {
  /** A pointer is there to hover with. */
  pointer: boolean;
  open: (item: ListedChat, anchor: LayoutAnchor) => void;
  hover: (item: ListedChat, anchor: LayoutAnchor) => void;
  leave: (item: ListedChat) => void;
}

/**
 * One row of the chat list: a group's header, a tab's divider, a pane's
 * terminal, an agent's row under its workspace, or a chat.
 */
export function ChatListItem({ row, prefs, actions, open, reads, openTerminalKey, layout, onSwiped }: {
  row: ListItemWithTerminals<ListedChat>;
  prefs: ReturnType<typeof useChatPrefs>;
  actions: ReturnType<typeof useChatActions<ListedChat>>;
  /** The chat open in the detail, which its row shows as selected. */
  open: OpenChat | null;
  reads: ReadsByConnection;
  /** The terminal open in the detail, as `connectionId\npaneId`. */
  openTerminalKey: string | null;
  layout: LayoutButton;
  /** A row was swiped: the hint has done its job. */
  onSwiped: () => void;
}) {
  const { colors } = useTheme();
  if (row.kind === 'group') return (
    <View
      testID={`chat-group-${row.id}`}
      accessibilityRole="header"
      accessibilityLabel={`${row.title}, ${row.count} chats`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: minTouchTarget, paddingVertical: spacing.sm }}>
      <Text variant="caption" mono color={row.id === 'needs-you' ? 'attention' : 'secondary'}>{row.title.toUpperCase()}</Text>
      <View style={{ height: 1, flex: 1, backgroundColor: row.id === 'needs-you' ? colors.attentionBorder : colors.separator }} />
      <Text variant="caption" mono color="secondary">{row.count}</Text>
    </View>
  );
  if (row.kind === 'tab') return <TabDivider summary={row.summary} tabId={row.tabId} label={row.label} first={row.first} />;
  if (row.kind === 'terminal') {
    const { summary, terminal } = row;
    return (
      <TerminalRow
        summary={summary}
        terminal={terminal}
        first={row.first}
        last={row.last}
        standalone={row.standalone}
        selected={openTerminalKey === `${summary.connectionId}\n${terminal.paneId}`}
        onPress={() => {
          Keyboard.dismiss();
          openTerminal(terminalRowParams(summary.connectionId, terminal));
        }}
      />
    );
  }
  const item = row.summary;
  // An agent's row in the Agents view: its pin, its read and its
  // thread are its agent's (`chatKey`). Rename and Close still act
  // on its workspace, as they do from an agent's row in Spaces.
  const agent = isAgentRow(item) ? item : null;
  const pinned = prefs.isPinned(item);
  const muted = prefs.isMuted(item);
  // Both belong to a conversation, so both wait for its session id.
  const personal = item.sessionSig !== null;
  const mutable = personal && prefs.canMute(item);
  // Compared on the row's own connection: one host's `w1` is not
  // another's.
  const openHere = openFor(open, item);
  const rowReads = readsOf(reads, item);
  // An agent's row splits beside its own pane, not the workspace's first.
  const manage = () => actions.manageChat(item, personal ? [
    { label: pinned ? 'Unpin' : 'Pin', onPress: () => prefs.togglePin(item) },
    ...(mutable ? [{ label: muted ? 'Unmute notifications' : 'Mute notifications', onPress: () => prefs.toggleMute(item) }] : []),
  ] : [], agent?.pane?.paneId);
  if (row.kind === 'pane') {
    const { pane } = row;
    const target = paneTarget(item, pane);
    // The agent's own pin and mute, as its row in Agents reads and
    // makes them (`agentPrefRow`): acting on the workspace from
    // here pinned something the other view never showed. The one
    // agent of its workspace is the workspace chat there, so it is
    // pinned and muted as the workspace here too.
    const own = target.paneId === undefined ? item : agentPrefRow(item, pane);
    const ownPersonal = own.sessionSig !== null;
    const ownPinned = prefs.isPinned(own);
    const ownMuted = prefs.isMuted(own);
    const ownMutable = ownPersonal && prefs.canMute(own);
    // That workspace pin is drawn once, on the card above: the same
    // pin on both rows read as two. Pin and Mute stay in this
    // row's long-press sheet.
    const sharesCard = target.paneId === undefined;
    return (
      <PaneRow
        summary={item}
        pane={pane}
        first={row.first}
        last={row.last}
        pinned={ownPinned && !sharesCard}
        muted={ownMuted && !sharesCard}
        selected={openHere === target.key}
        unread={isPaneUnread(item, pane, rowReads, openHere)}
        onPress={() => {
          Keyboard.dismiss();
          openChat(item.connectionId, item.workspaceId, target.title, target.paneId,
            target.paneId === undefined ? item.sessionSig : pane.sessionSig);
        }}
        onLongPress={() => actions.manageChat(item, ownPersonal ? [
          { label: ownPinned ? 'Unpin' : 'Pin', onPress: () => prefs.togglePin(own) },
          ...(ownMutable ? [{ label: ownMuted ? 'Unmute notifications' : 'Mute notifications', onPress: () => prefs.toggleMute(own) }] : []),
        ] : [], pane.paneId)}
      />
    );
  }
  // A workspace card that stands for the workspace rather than one
  // chat (`spaceCardMode`) shows its layout, and is never the
  // selection: the agent rows under it are.
  const space = agent === null && spaceCardMode(item) === 'space';
  return (
    <SwipeableChatRow
      summary={item}
      testKey={agent === null ? undefined : agentTestKey(agent)}
      pinned={pinned}
      muted={muted}
      onTogglePin={personal ? () => prefs.togglePin(item) : undefined}
      onToggleMute={mutable ? () => prefs.toggleMute(item) : undefined}
      selected={!space && openHere === (agent?.chatKey ?? item.workspaceId)}
      unread={agent === null ? isChatUnread(item, rowReads, openHere) : isAgentUnread(agent, rowReads, openHere)}
      onPress={() => {
        Keyboard.dismiss();
        openChat(item.connectionId, item.workspaceId, rowTitle(item), agent?.pane?.paneId,
          agent?.pane != null ? agent.pane.sessionSig : item.sessionSig);
      }}
      onLongPress={manage}
      onSwiped={onSwiped}
      onRename={() => actions.renameChat(item)}
      onClose={() => actions.closeChat(item)}
      space={space ? {
        onOpenLayout: (anchor) => layout.open(item, anchor),
        onHoverLayout: layout.pointer ? (anchor) => layout.hover(item, anchor) : undefined,
        onLeaveLayout: layout.pointer ? () => layout.leave(item) : undefined,
      } : undefined}
    />
  );
}
