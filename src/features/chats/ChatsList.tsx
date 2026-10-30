import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showActionSheet } from '@/components/ActionSheet';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { agentRowKey, isAgentRow } from './agentRows';
import { ChatListItem, type LayoutButton } from './ChatListItem';
import { ChatSearch } from './ChatSearch';
import { paneChats } from './chatGroups';
import { paneTarget } from './paneTarget';
import { paneTitle, rowTitle } from './rowText';
import { useHostRecovery } from './useHostRecovery';
import { useListReads } from './useListReads';
import { SkeletonRows } from '@/features/chats/SkeletonRows';
import { useChatPrefs } from '@/features/chats/useChatPrefs';
import type { ListItemWithTerminals } from '@/features/terminal/listRows';
import { chatListRows } from './chatListRows';
import { isTerminalAvailable } from '../../../modules/herdr-terminal/src';
import { SwipeHint } from '@/features/chats/SwipeHint';
import { StarCard } from '@/features/welcome/StarCard';
import { HostKeyChangedBanner } from '@/features/chats/HostKeyChangedBanner';
import { IntegrationBanner } from '@/features/chats/IntegrationBanner';
import { useOutdatedIntegrations } from '@/features/chats/useOutdatedIntegrations';
import { useAttentionBadge } from '@/features/chats/useAttentionBadge';
import { useChatActions } from '@/features/chats/useChatActions';
import { useHostChats } from '@/features/chats/useHostChats';
import { HostNotices } from '@/features/chats/HostNotices';
import { HostFeeds } from '@/features/chats/HostFeeds';
import { NotesBar } from '@/features/youShouldKnow/NotesBar';
import { useNotesOf } from '@/features/youShouldKnow/useHostNotes';
import { UsageFooter } from '@/features/chats/UsageFooter';
import { rowKey, type ListedChat, type OpenChat } from '@/features/chats/listedChat';
import { LayoutPeekOverlay, useLayoutPeek } from '@/features/spaces/LayoutPeek';
import { connectionRecovery } from '@/lib/connectionRecovery';
import { haptics } from '@/components/haptics';
import { chatKey } from '@/lib/chatKey';
import {
  LIST_MODE_SHEET_TITLE,
  emptyListState,
  listModeAccessibilityLabel,
  listModeActions,
  listModeTitle,
  type ListMode,
} from '@/lib/listModes';
import { decodeActiveDays, shouldAskForStar } from '@/lib/welcome';
import { chatOf, useChatSelection } from '@/state/chatSelection';
import { useSpaceLayoutSheet } from '@/state/spaceLayout';
import { clientFor, isDemo, newConnection, useSelectedConnection } from '@/state/connections';
import { setSetting } from '@/state/db';
import { saveSetting } from '@/state/saveSetting';
import { encodeBool, useSettings } from '@/state/settings';
import { useTheme } from '@/theme/ThemeProvider';
import { screenPadding, size, spacing } from '@/theme/tokens';

/**
 * Chats, the app's root, in one of two views picked from its title
 * (`listModes`). Spaces: one row per workspace, with live presence, and under
 * a workspace that runs several agents, one row for each of them. Agents: one
 * row per agent, flat (`agentRows`), grouped, pinned and read by the same
 * rules. Hosts and Settings are behind the menu in its header, not beside it
 * in a tab bar.
 *
 * Thin by design: everything it knows comes from `useHostChats` (the host's
 * `useWorkspaces`, and one for each other saved host), everything it
 * draws comes from `ChatRow`, and everything it does to a workspace comes from
 * `useChatActions`, on the row's own connection.
 */
export default function ChatsList({ selectedWorkspaceId, selectedConnectionId, selectedTerminal }: {
  selectedWorkspaceId?: string;
  /** The open chat's connection: the selected host's or another's. Absent: the selected host's. */
  selectedConnectionId?: string;
  /** The pane whose terminal is the iPad's detail. Never set with a chat: one detail at a time. */
  selectedTerminal?: OpenTerminal;
}) {
  const connection = useSelectedConnection();
  // Keyed by server: switching hosts is a different conversation list, not an
  // update to this one, so the whole thing remounts rather than being reset
  // field by field.
  return (
    <ChatsForServer
      key={connection?.id ?? 'none'}
      selectedWorkspaceId={selectedWorkspaceId}
      selectedConnectionId={selectedConnectionId}
      selectedTerminal={selectedTerminal}
    />
  );
}

/** A pane's terminal open in the detail, by its row's connection and pane. */
interface OpenTerminal {
  connectionId: string;
  paneId: string;
}

function ChatsForServer({ selectedWorkspaceId, selectedConnectionId, selectedTerminal }: {
  selectedWorkspaceId?: string;
  selectedConnectionId?: string;
  selectedTerminal?: OpenTerminal;
}) {
  const router = useRouter();
  // The open chat, if a chat is the detail: a terminal has no row title to
  // keep in step and no pane chat to light.
  const selection = useChatSelection((state) => chatOf(state.detail));
  const select = useChatSelection((state) => state.select);
  const workspaceClosed = useChatSelection((state) => state.workspaceClosed);
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const connection = useSelectedConnection();
  const client = useMemo(() => (connection === null ? null : clientFor(connection)), [connection]);

  // Every host's chats in one list. The selected host's error and loading
  // are the list's; another host's failure is a notice at the end.
  const chats = useHostChats(connection, client);
  const { summaries, loading, error, errorCode, refresh, notices, connectionIds } = chats;
  const notes = useNotesOf(connectionIds);
  const integrations = useOutdatedIntegrations(client);
  const [query, setQuery] = useState('');
  const prefs = useChatPrefs(db, connection, summaries, connectionIds);
  const listMode = useSettings((state) => state.listMode);
  const list = useRef<FlashListRef<ListItemWithTerminals<ListedChat>>>(null);
  // The other view opens at its top, at Needs you, as Mail does after a
  // filter change: the same list under new rows kept the old offset, and
  // landed partway down, past the groups that matter.
  const chooseListMode = useCallback((mode: ListMode) => {
    list.current?.scrollToOffset({ offset: 0, animated: false });
    saveSetting(db, 'listMode', mode);
  }, [db]);
  const rows = useMemo(
    () => chatListRows(listMode, summaries, query, prefs.pinnedAt, isTerminalAvailable),
    [listMode, summaries, query, prefs.pinnedAt]
  );
  const { keyChanged, storedPin, fixing, recover } = useHostRecovery({ connection, client, error, errorCode, refresh });
  // The selection names the pane too; the prop only says which workspace, and
  // a pane row and its workspace's row are never selected together. A pane
  // that is not a chat of its own is the workspace chat to the list: its row
  // is gone (its workspace is back to one agent, or it closed), or it is the
  // one agent of a space card, whose row is the workspace chat (`paneTarget`).
  // Otherwise nothing was highlighted, and the thread being read lit its own
  // workspace's dot and badge: an agent opened as `w6/w6:p2` while w6 held
  // two, left alone beside a shell when the other exited, kept that key while
  // its row was keyed `w6`.
  //
  // By connection too: one host's `w1` is not another's.
  const openConnectionId = selectedConnectionId ?? connection?.id ?? null;
  const selectedSummary = summaries.find((item) =>
    item.workspaceId === selectedWorkspaceId && item.connectionId === openConnectionId);
  const selectedPaneId = selectedWorkspaceId !== undefined && selection?.workspaceId === selectedWorkspaceId &&
    selection.connectionId === openConnectionId &&
    selectedSummary !== undefined &&
    paneChats(selectedSummary).some((pane) => pane.paneId === selection.paneId && paneTarget(selectedSummary, pane).paneId !== undefined)
    ? selection.paneId : undefined;
  const openKey = selectedWorkspaceId === undefined ? null : chatKey({ workspaceId: selectedWorkspaceId, paneId: selectedPaneId });
  const open = useMemo((): OpenChat | null =>
    openKey === null || openConnectionId === null ? null : { connectionId: openConnectionId, key: openKey },
  [openKey, openConnectionId]);
  // Whatever a row draws from outside its item: the selection, and the read
  // markers its unread dot compares against. A pane changes neither the rows
  // nor the workspace id, so without the key its highlight would not repaint.
  // The open terminal is in it too, for the same reason: its row lights up.
  const terminalConnectionId = selectedTerminal?.connectionId;
  const terminalPaneId = selectedTerminal?.paneId;
  const openTerminalKey = terminalConnectionId === undefined || terminalPaneId === undefined
    ? null : `${terminalConnectionId}\n${terminalPaneId}`;
  const reads = useListReads(db, connectionIds.join('\n'), open, refresh);
  const listExtra = useMemo(() => ({ open, reads, openTerminalKey }), [open, reads, openTerminalKey]);
  const insets = useSafeAreaInsets();

  const actions = useChatActions<ListedChat>({
    client,
    connectionId: connection?.id ?? null,
    // Another host's chat is renamed and closed on that host.
    targetOf: chats.targetOf,
    db,
    refresh,
    // The open chat, or a terminal on one of the closed workspace's panes,
    // goes with it. Not by `selectedWorkspaceId`: with a terminal open no
    // workspace is selected, and the terminal stayed on a pane that was gone.
    onClosed: useCallback((workspaceId: string, closedOn: string) => {
      const closed = summaries.find((item) => item.workspaceId === workspaceId && item.connectionId === closedOn);
      const paneIds = closed === undefined ? []
        : [...closed.panes.map((pane) => pane.paneId), ...closed.shellPanes.map((pane) => pane.paneId)];
      workspaceClosed({ connectionId: closedOn, workspaceId, paneIds });
    }, [summaries, workspaceClosed]),
  });

  // Renaming from the persistent sidebar must also update the open header,
  // and so must a session that retitles itself.
  // The one agent of a space card's workspace is the workspace chat
  // (`paneTarget`): open without a pane, it is still that agent's title.
  const selectedPane = selectedSummary?.panes.find((pane) => pane.paneId === selectedPaneId) ??
    (selectedSummary !== undefined && selectedPaneId === undefined && paneChats(selectedSummary).length === 1
      ? selectedSummary.panes[0] : undefined);
  const selectedTitle = selectedSummary === undefined ? undefined
    : selectedPane === undefined ? rowTitle(selectedSummary) : paneTitle(selectedSummary, selectedPane);
  useEffect(() => {
    if (selection !== null && selectedTitle !== undefined && selectedTitle !== selection.title) {
      select({ ...selection, title: selectedTitle });
    }
  }, [selectedTitle, selection, select]);

  // A space card's layout: on iPad a floating card beside the list, level
  // with its button, shown on hover and pinned by a tap; a sheet on a phone.
  const peek = useLayoutPeek();
  const peekSummary = peek.peek === null ? null : summaries.find((item) => rowKey(item) === peek.peek?.key) ?? null;
  const pointer = Platform.OS === 'ios' && Platform.isPad;
  const layoutButton: LayoutButton = {
    pointer,
    open: (item, anchor) => {
      Keyboard.dismiss();
      if (pointer) {
        peek.show(rowKey(item), anchor, 'pin');
        return;
      }
      useSpaceLayoutSheet.getState().show(item);
      router.push('/space-layout');
    },
    hover: (item, anchor) => peek.show(rowKey(item), anchor, 'hover'),
    leave: (item) => peek.leaveButton(rowKey(item)),
  };


  // The chat on screen is not news. With one agent of a workspace open, the
  // workspace still counts for its other agents.
  useAttentionBadge(summaries, reads, connection !== null, open);

  /**
   * The hint stops the first time the gesture is used, so it teaches rather than
   * expires. Written through the same store-plus-mirror path as every other
   * persisted preference.
   */
  const seenSwipeHint = useSettings((state) => state.seenSwipeHint);
  const markHintSeen = useCallback(() => {
    if (useSettings.getState().seenSwipeHint) return;
    useSettings.getState().set('seenSwipeHint', true);
    void setSetting(db, 'seenSwipeHint', encodeBool(true));
  }, [db]);

  /**
   * The one-time star request, below the chats where it never covers one.
   * Either answer (star or "Not now") puts it away for good.
   */
  const starAsked = useSettings((state) => state.starAsked);
  const activeDays = useSettings((state) => state.activeDays);
  const askForStar =
    rows.length > 0 &&
    shouldAskForStar({ days: decodeActiveDays(activeDays), starAsked, onRealHost: connection !== null && !isDemo(connection.id) });
  const answerStar = useCallback(() => saveSetting(db, 'starAsked', true), [db]);


  return (
    <Screen>
      {/* One poll per other saved host, feeding `useHostChats`. */}
      {connection !== null && <HostFeeds selectedId={connection.id} />}
      <Header
        title={listModeTitle(listMode)}
        titleMenu={{
          label: listModeAccessibilityLabel(listMode),
          testID: 'chats-view',
          onPress: () => showActionSheet({ title: LIST_MODE_SHEET_TITLE, actions: listModeActions(listMode, chooseListMode) }),
        }}
        subtitle={connection?.name ?? null}
        onSubtitlePress={() => router.navigate('/hosts')}
        actionSymbol="square.and.pencil"
        actionLabel="New chat"
        onAction={connection === null ? undefined : () => router.push('/new-chat')}
        // New chat and Settings are the header's two glyphs; Hosts is the host's
        // name under the title, and Chats and Computers are the tab bar.
        menuSymbol="gearshape"
        menuTestID="chats-settings"
        menuLabel="Settings"
        onMenu={() => router.navigate('/settings')}
      />
      {/* "You should know"'s notes, on hosts whose Claude Code has it on; nothing on any other. */}
      <NotesBar notes={notes} onPress={() => router.navigate('/you-should-know')} />

      {/* Rename and close fail outside the poll's own error path, so they get
          their own banner, dismissible, because unlike a connection error this
          one is about an action that is over. */}
      {prefs.error !== null && (
        <ErrorBanner message={prefs.error} onDismiss={prefs.clearError} />
      )}
      {actions.error !== null && (
        <ErrorBanner message={actions.error} onDismiss={actions.clearError} />
      )}

      {/* With nothing listed, the failure is the whole screen (below), not a
          banner above an empty state that pretends the host has no chats. */}
      {error !== null && (summaries.length > 0 || keyChanged) &&
        (keyChanged ? (
          <HostKeyChangedBanner
            pin={storedPin}
            onOpenEditor={() =>
              router.push({ pathname: '/server/[id]', params: { id: connection?.id ?? '' } })
            }
          />
        ) : (
          // Same recovery as the empty state below: with cached rows on
          // screen a rejected key or an unreachable host showed a message and
          // no way to fix it (#4 acceptance).
          <ErrorBanner
            message={error}
            actionLabel={fixing ? 'Working…' : connectionRecovery(errorCode).label}
            onAction={fixing ? undefined : recover}
          />
        ))}

      {connection !== null && summaries.length > 0 && <ChatSearch query={query} onChange={setQuery} />}

      {connection === null ? (
        <EmptyState
          symbol="server.rack"
          title="No hosts yet"
          body="Add a machine that runs herdr. HerdrChat reaches it over SSH on your tailnet, nothing is exposed publicly."
          actionLabel="Add a host"
          // Straight to the editor, not to the server list: with no servers the
          // list is just this same empty state again, and making someone tap
          // through two identical screens to reach a form is not a step, it's a
          // toll.
          onAction={() =>
            router.push({ pathname: '/server/[id]', params: { id: newConnection().id } })
          }
        />
      ) : summaries.length === 0 ? (
        loading ? (
          <SkeletonRows key={connection.id} host={connection} />
        ) : (
          // Scrollable only so it can be pulled to refresh; an empty list used to
          // offer no way to ask again at all.
          <ScrollView
            contentContainerStyle={{ flexGrow: 1 }}
            refreshControl={
              <RefreshControl
                refreshing={false}
                onRefresh={() => {
                  haptics.light();
                  void refresh();
                }}
                tintColor={colors.tint}
                colors={[colors.tint]}
                progressBackgroundColor={colors.secondarySystemBackground}
              />
            }>
            {error !== null && !keyChanged ? (
              // A host that could not be reached is not a host with no chats
              // (#96). Say which failure it was and offer the fix that matches.
              <EmptyState
                symbol="exclamationmark.triangle"
                title={connectionRecovery(errorCode).title}
                body={error}
                actionLabel={fixing ? 'Working…' : connectionRecovery(errorCode).label}
                onAction={fixing ? undefined : recover}
              />
            ) : error === null ? (
              <EmptyState
                symbol="tray"
                title="No workspaces"
                body={`Workspaces you open in herdr on ${connection.name} appear here.`}
                actionLabel="Start a chat"
                onAction={() => router.push('/new-chat')}
              />
            ) : null}
            {notices.length > 0 && (
              <View style={{ paddingHorizontal: screenPadding }}>
                <HostNotices notices={notices} />
              </View>
            )}
            {/* Not under a host that could not be reached: its usage would
                be as stale as its chats. */}
            {error === null && (
              <View style={{ paddingHorizontal: screenPadding, paddingBottom: insets.bottom + size.floatingBarClearance }}>
                <UsageFooter host={connection} transport={client?.transport ?? null} />
              </View>
            )}
          </ScrollView>
        )
      ) : (
        <FlashList
          ref={list}
          data={rows}
          extraData={listExtra}
          keyExtractor={(item) =>
            item.kind === 'group' ? `group-${item.id}`
              : item.kind === 'pane' ? `pane-${rowKey(item.summary)}-${item.pane.paneId}`
                : item.kind === 'terminal' ? `terminal-${rowKey(item.summary)}-${item.terminal.paneId}`
                : item.kind === 'tab' ? `${rowKey(item.summary)}/tab/${item.tabId}`
                : isAgentRow(item.summary) ? `agent-${agentRowKey(item.summary)}` : rowKey(item.summary)}
          getItemType={(item) => item.kind}
          // FlashList keeps the first visible row in place by default, so a
          // group that appears at the top (a chat pinned, or one that starts
          // needing you) landed ABOVE the screen at a scroll of zero, and the
          // chat you had just pinned seemed to vanish. The top of this list is
          // the part that matters, so it stays put instead.
          maintainVisibleContentPosition={{ disabled: true }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          // The list runs under the floating tab bar and the home indicator, so
          // the last row has to be able to scroll clear of both.
          contentContainerStyle={{ paddingHorizontal: screenPadding, paddingBottom: insets.bottom + size.floatingBarClearance }}
          // Below the rows, not above them: the host answers the integration
          // check after the list has drawn, and a banner arriving on top pushed
          // every row down under a finger that was about to tap one (#4
          // acceptance: a tap meant for one chat opened the next).
          ListFooterComponent={
            <>
              {error === null && integrations.issues.length > 0 && (
                <IntegrationBanner
                  issues={integrations.issues}
                  updating={integrations.updating}
                  error={integrations.error}
                  onUpdate={() => void integrations.update()}
                />
              )}
              <HostNotices notices={notices} />
              {/* As in the empty list: not under a host that could not be
                  reached, whose poll has stopped, or the footer's own read
                  would keep asking it every few seconds. */}
              {error === null && (
                <UsageFooter host={connection} transport={client?.transport ?? null} style={{ marginTop: spacing.lg }} />
              )}
              {seenSwipeHint || rows.length === 0 ? null : <SwipeHint />}
              {askForStar && (
                <View style={{ marginTop: spacing.lg }}>
                  <StarCard testID="star-card" onStar={answerStar} onDismiss={answerStar} />
                </View>
              )}
            </>
          }
          ListEmptyComponent={emptyListState(listMode, query) === 'no-agents' ? (
            // Every workspace is a shell: a list of agents with none in it
            // is not a failed search.
            <EmptyState
              symbol="person.2"
              title="No agents"
              body={`No workspace on ${connection.name} is running an agent. Spaces lists them all.`}
              actionLabel="Show Spaces"
              onAction={() => chooseListMode('spaces')}
            />
          ) : (
            <EmptyState symbol="magnifyingglass" title="No matching chats" body="Try another chat name, agent or folder." />
          )}
          renderItem={({ item: row }) => (
            <ChatListItem
              row={row}
              prefs={prefs}
              actions={actions}
              open={open}
              reads={reads}
              openTerminalKey={openTerminalKey}
              layout={layoutButton}
              onSwiped={markHintSeen}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={false}
              // Felt at the moment the pull commits, not when data lands. Every
              // refresh is an SSH round-trip over a tailnet, so there is a beat
              // before anything changes, and your thumb is over the spinner.
              onRefresh={() => {
                haptics.light();
                void refresh();
              }}
              tintColor={colors.tint}
              // Android's spinner ignores tintColor: black on a white disc
              // otherwise, in either scheme.
              colors={[colors.tint]}
              progressBackgroundColor={colors.secondarySystemBackground}
            />
          }
        />
      )}
      <LayoutPeekOverlay
        column={peek.column}
        peek={peek.peek}
        summary={peekSummary}
        onClose={peek.close}
        onPin={peek.pin}
        onHoverCard={peek.hoverCard}
      />
    </Screen>
  );
}
