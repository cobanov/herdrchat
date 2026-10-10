import { FlashList } from '@shopify/flash-list';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmDestructive, showActionSheet } from '@/components/ActionSheet';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { openChat } from './navigation';
import { groupChats, paneChats } from './chatGroups';
import { isChatUnread, isPaneUnread } from './chatUnread';
import { PaneRow } from './PaneRow';
import { paneTitle, rowTitle } from './rowText';
import { SkeletonRows } from '@/features/chats/SkeletonRows';
import { SwipeableChatRow } from '@/features/chats/SwipeableChatRow';
import { useChatPrefs } from '@/features/chats/useChatPrefs';
import { SwipeHint } from '@/features/chats/SwipeHint';
import { StarCard } from '@/features/welcome/StarCard';
import { HostKeyChangedBanner } from '@/features/chats/HostKeyChangedBanner';
import { IntegrationBanner } from '@/features/chats/IntegrationBanner';
import { useOutdatedIntegrations } from '@/features/chats/useOutdatedIntegrations';
import { useAttentionBadge } from '@/features/chats/useAttentionBadge';
import { useChatActions } from '@/features/chats/useChatActions';
import { useHostChats } from '@/features/chats/useHostChats';
import { MachineNotices } from '@/features/chats/MachineNotices';
import { MachineFeeds } from '@/features/chats/MachineChats';
import { openFor, readsOf, rowKey, type ListedChat, type OpenChat, type ReadsByConnection } from '@/features/chats/listedChat';
import { connectionRecovery } from '@/lib/connectionRecovery';
import { haptics } from '@/lib/haptics';
import { chatKey } from '@/lib/chatKey';
import { mainMenuActions, mainMenuTitle } from '@/lib/mainMenu';
import { decodeActiveDays, shouldAskForStar } from '@/lib/welcome';
import { useChatEdits } from '@/state/chatEdits';
import { useChatSelection } from '@/state/chatSelection';
import {
  clientFor,
  isDemo,
  loadHostKeyPin,
  newConnection,
  useSelectedConnection,
} from '@/state/connections';
import { loadThreadReads, setSetting } from '@/state/db';
import { saveSetting } from '@/state/saveSetting';
import { encodeBool, useSettings } from '@/state/settings';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, screenPadding, spacing, typography } from '@/theme/tokens';

/**
 * Chats, the app's root. One row per workspace, with live presence, and under
 * a workspace that runs several agents, one row for each of them. Hosts and
 * Settings are behind the menu in its header, not beside it in a tab bar.
 *
 * Thin by design: everything it knows comes from `useHostChats` (the host's
 * `useWorkspaces`, and one for each machine saved on the host), everything it
 * draws comes from `ChatRow`, and everything it does to a workspace comes from
 * `useChatActions`, on the row's own connection.
 */
export default function ChatsList({ selectedWorkspaceId, selectedConnectionId }: {
  selectedWorkspaceId?: string;
  /** The open chat's connection: the host's, or one of its machines'. Absent: the host's. */
  selectedConnectionId?: string;
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
    />
  );
}

function ChatsForServer({ selectedWorkspaceId, selectedConnectionId }: {
  selectedWorkspaceId?: string;
  selectedConnectionId?: string;
}) {
  const router = useRouter();
  const selection = useChatSelection((state) => state.selection);
  const select = useChatSelection((state) => state.select);
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const connection = useSelectedConnection();
  const client = useMemo(() => (connection === null ? null : clientFor(connection)), [connection]);

  // The host's chats and its machines' in one list. The host's error and
  // loading are the list's; a machine's failure is a notice at the end.
  const chats = useHostChats(connection, client);
  const { summaries, loading, error, errorCode, refresh, notices, connectionIds } = chats;
  const integrations = useOutdatedIntegrations(client);
  const [query, setQuery] = useState('');
  const prefs = useChatPrefs(db, connection, summaries, connectionIds);
  const rows = useMemo(() => groupChats(summaries, query, prefs.pinnedAt, rowKey), [summaries, query, prefs.pinnedAt]);
  // Whose reads to load, as a string so a rebuilt list of the same ids does
  // not reload them.
  const readIds = connectionIds.join('\n');
  /** One flag for both recovery actions, only one is ever offered at a time. */
  const [fixing, setFixing] = useState(false);
  // A key change is not one failure among many: it is the only one where the
  // right move might be to stop using the app. It gets its own surface.
  // By code, not by the message: the wording is the transport's to change, and
  // it did (the native sentence became a plain one), which silently turned
  // this banner back into an ordinary error.
  const keyChanged = error !== null && errorCode === 'host_key_changed';
  const [storedPin, setStoredPin] = useState<string | null>(null);
  useEffect(() => {
    if (!keyChanged || connection === null) return;
    let alive = true;
    void loadHostKeyPin(connection.id).then((pin) => {
      if (alive) setStoredPin(pin);
    });
    return () => {
      alive = false;
    };
  }, [keyChanged, connection]);
  const [reads, setReads] = useState<ReadsByConnection>(new Map());
  // The selection names the pane too; the prop only says which workspace, and
  // a pane row and its workspace's row are never selected together. A pane
  // whose row is gone (its workspace is back to one agent, or it closed) is
  // the workspace chat to the list: otherwise nothing was highlighted, and the
  // thread being read lit its own workspace's dot and badge.
  //
  // By connection too: a machine's `w1` is not the host's `w1`.
  const openConnectionId = selectedConnectionId ?? connection?.id ?? null;
  const selectedSummary = summaries.find((item) =>
    item.workspaceId === selectedWorkspaceId && item.connectionId === openConnectionId);
  const selectedPaneId = selectedWorkspaceId !== undefined && selection?.workspaceId === selectedWorkspaceId &&
    selection.connectionId === openConnectionId &&
    selectedSummary !== undefined && paneChats(selectedSummary).some((pane) => pane.paneId === selection.paneId)
    ? selection.paneId : undefined;
  const openKey = selectedWorkspaceId === undefined ? null : chatKey({ workspaceId: selectedWorkspaceId, paneId: selectedPaneId });
  const open = useMemo((): OpenChat | null =>
    openKey === null || openConnectionId === null ? null : { connectionId: openConnectionId, key: openKey },
  [openKey, openConnectionId]);
  // Whatever a row draws from outside its item: the selection, and the read
  // markers its unread dot compares against. A pane changes neither the rows
  // nor the workspace id, so without the key its highlight would not repaint.
  const listExtra = useMemo(() => ({ open, reads }), [open, reads]);
  const insets = useSafeAreaInsets();

  const actions = useChatActions<ListedChat>({
    client,
    connectionId: connection?.id ?? null,
    // A machine's chat is renamed and closed on the machine.
    targetOf: chats.targetOf,
    db,
    refresh,
    onClosed: useCallback((workspaceId: string, closedOn: string) => {
      if (workspaceId === selectedWorkspaceId && closedOn === openConnectionId) select(null);
    }, [selectedWorkspaceId, openConnectionId, select]),
  });

  // Renaming from the persistent sidebar must also update the open header,
  // and so must a session that retitles itself.
  const selectedPane = selectedSummary?.panes.find((pane) => pane.paneId === selectedPaneId);
  const selectedTitle = selectedSummary === undefined ? undefined
    : selectedPane === undefined ? rowTitle(selectedSummary) : paneTitle(selectedSummary, selectedPane);
  useEffect(() => {
    if (selection !== null && selectedTitle !== undefined && selectedTitle !== selection.title) {
      select({ ...selection, title: selectedTitle });
    }
  }, [selectedTitle, selection, select]);

  const editsDirty = useChatEdits((state) => state.dirty);
  const clearEdits = useChatEdits((state) => state.clear);
  // Re-read on focus rather than on an interval: the only thing that changes a
  // read marker is opening a thread, and coming back from one is exactly this
  // callback. A poll would just re-query the same rows every few seconds.
  useFocusEffect(
    useCallback(() => {
      if (readIds === '') return;
      void loadReads(db, readIds).then(setReads);
      // A rename happened in the sheet that just closed. Re-fetch rather than
      // wait out the poll, but only then, refreshing on every focus would cost
      // a round-trip each time a sheet above this list closes.
      if (editsDirty) {
        clearEdits();
        void refresh();
      }
    }, [db, readIds, editsDirty, clearEdits, refresh])
  );

  // The tablet list stays focused as its detail changes. Refresh read markers
  // after the previous detail has stamped its final read time on unmount.
  // By chat key, not workspace: moving between two agents of one workspace
  // closes a thread too.
  useEffect(() => {
    if (readIds === '' || open === null) return;
    let alive = true;
    void loadReads(db, readIds).then((next) => { if (alive) setReads(next); });
    return () => { alive = false; };
  }, [db, readIds, open]);

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

  /**
   * The two things that can be fixed from here, and they are different sizes.
   *
   * Missing herdr downloads and runs an install script; a stopped server is one
   * process. Offering them as one button would make the smaller one feel as
   * consequential as the larger.
   */
  /** The fix that matches the failure, for the banner and the empty state alike. */
  const recover = () => {
    const { action } = connectionRecovery(errorCode ?? '');
    if (action === 'install') confirmInstallHerdr();
    else if (action === 'start') void fixHost('start');
    else if (action === 'retry') void refresh();
    else if (connection !== null) router.push({ pathname: '/server/[id]', params: { id: connection.id } });
  };

  const fixHost = async (action: 'install' | 'start') => {
    if (client === null) return;
    setFixing(true);
    try {
      await (action === 'install' ? client.installHerdr() : client.startServer());
      await refresh();
    } catch {
      // The poll's own banner already carries the failure; a second one here
      // would stack two messages about one problem.
    } finally {
      setFixing(false);
    }
  };

  /**
   * Never one tap. Installing pipes a script from the network into a shell on
   * someone's machine, so the exact command is stated and confirmed before it
   * runs, the same bargain a terminal would offer, where you would at least
   * have typed it. Starting a stopped server is not in that class and goes
   * straight through.
   */
  const confirmInstallHerdr = () => {
    if (connection === null) return;
    confirmDestructive({
      title: 'Run the herdr installer?',
      message: `This runs curl -fsSL https://herdr.dev/install.sh | sh on ${connection.host} as ${connection.username}. It downloads a script from herdr.dev and runs it there.`,
      confirmLabel: 'Run the installer',
      onConfirm: () => void fixHost('install'),
    });
  };

  return (
    <Screen>
      {/* One poll per machine saved on the host, feeding `useHostChats`. */}
      {connection !== null && <MachineFeeds host={connection} />}
      <Header
        title="Chats"
        subtitle={connection?.name ?? null}
        onSubtitlePress={() => router.navigate('/hosts')}
        actionSymbol="square.and.pencil"
        actionLabel="New chat"
        onAction={connection === null ? undefined : () => router.push('/new-chat')}
        menuTestID="chats-menu"
        onMenu={() =>
          showActionSheet({
            title: mainMenuTitle(connection?.name),
            actions: mainMenuActions({
              hasConnection: connection !== null,
              newChat: () => router.push('/new-chat'),
              hosts: () => router.navigate('/hosts'),
              settings: () => router.navigate('/settings'),
            }),
          })
        }
      />

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
            actionLabel={fixing ? 'Working…' : connectionRecovery(errorCode ?? '').label}
            onAction={fixing ? undefined : recover}
          />
        ))}

      {connection !== null && summaries.length > 0 && (
        <View style={{ paddingHorizontal: screenPadding, paddingBottom: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: colors.chatCard }}>
            <Icon name="magnifyingglass" tintColor={colors.secondaryLabel} />
            <TextInput
              testID="chat-search"
              accessibilityLabel="Search chats"
              placeholder="Search chats"
              placeholderTextColor={colors.secondaryLabel}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              returnKeyType="search"
              style={{ flex: 1, minWidth: 0, minHeight: minTouchTarget, paddingVertical: spacing.md, color: colors.label, fontSize: typography.body.fontSize }}
            />
          </View>
        </View>
      )}

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
              />
            }>
            {error !== null && !keyChanged ? (
              // A host that could not be reached is not a host with no chats
              // (#96). Say which failure it was and offer the fix that matches.
              <EmptyState
                symbol="exclamationmark.triangle"
                title={connectionRecovery(errorCode ?? '').title}
                body={error}
                actionLabel={fixing ? 'Working…' : connectionRecovery(errorCode ?? '').label}
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
                <MachineNotices notices={notices} />
              </View>
            )}
          </ScrollView>
        )
      ) : (
        <FlashList
          data={rows}
          extraData={listExtra}
          keyExtractor={(item) =>
            item.kind === 'group' ? `group-${item.id}`
              : item.kind === 'pane' ? `pane-${rowKey(item.summary)}-${item.pane.paneId}` : rowKey(item.summary)}
          getItemType={(item) => item.kind}
          // FlashList keeps the first visible row in place by default, so a
          // group that appears at the top (a chat pinned, or one that starts
          // needing you) landed ABOVE the screen at a scroll of zero, and the
          // chat you had just pinned seemed to vanish. The top of this list is
          // the part that matters, so it stays put instead.
          maintainVisibleContentPosition={{ disabled: true }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          // The list runs under the home indicator (the screen's safe area
          // leaves the bottom edge to it), so the last row has to be able to
          // scroll clear of it.
          contentContainerStyle={{ paddingHorizontal: screenPadding, paddingBottom: insets.bottom + spacing.xl }}
          // Below the rows, not above them: the host answers the integration
          // check after the list has drawn, and a banner arriving on top pushed
          // every row down under a finger that was about to tap one (#4
          // acceptance: a tap meant for one chat opened the next).
          ListFooterComponent={
            <>
              {error === null && integrations.outdated.length > 0 && (
                <IntegrationBanner
                  outdated={integrations.outdated}
                  updating={integrations.updating}
                  error={integrations.error}
                  onUpdate={() => void integrations.update()}
                />
              )}
              <MachineNotices notices={notices} />
              {seenSwipeHint || rows.length === 0 ? null : <SwipeHint />}
              {askForStar && (
                <View style={{ marginTop: spacing.lg }}>
                  <StarCard testID="star-card" onStar={answerStar} onDismiss={answerStar} />
                </View>
              )}
            </>
          }
          ListEmptyComponent={<EmptyState symbol="magnifyingglass" title="No matching chats" body="Try another chat name, agent or folder." />}
          renderItem={({ item: row }) => {
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
            const item = row.summary;
            const pinned = prefs.isPinned(item);
            const muted = prefs.isMuted(item);
            // Both belong to a conversation, so both wait for its session id.
            const personal = item.sessionSig !== null;
            // Only the host's own chats notify, so only they can be muted.
            const mutable = personal && prefs.canMute(item);
            // Compared on the row's own connection: a machine's `w1` is not
            // the host's.
            const openHere = openFor(open, item);
            const rowReads = readsOf(reads, item);
            const manage = () => actions.manageChat(item, personal ? [
              { label: pinned ? 'Unpin' : 'Pin', onPress: () => prefs.togglePin(item) },
              ...(mutable ? [{ label: muted ? 'Unmute notifications' : 'Mute notifications', onPress: () => prefs.toggleMute(item) }] : []),
            ] : []);
            if (row.kind === 'pane') {
              const { pane } = row;
              return (
                <PaneRow
                  summary={item}
                  pane={pane}
                  first={row.first}
                  last={row.last}
                  selected={openHere === chatKey({ workspaceId: item.workspaceId, paneId: pane.paneId })}
                  unread={isPaneUnread(item, pane, rowReads, openHere)}
                  onPress={() => {
                    Keyboard.dismiss();
                    openChat(item.connectionId, item.workspaceId, paneTitle(item, pane), pane.paneId);
                  }}
                  onLongPress={manage}
                />
              );
            }
            return (
              <SwipeableChatRow
                summary={item}
                pinned={pinned}
                muted={muted}
                onTogglePin={personal ? () => prefs.togglePin(item) : undefined}
                onToggleMute={mutable ? () => prefs.toggleMute(item) : undefined}
                selected={openHere === item.workspaceId}
                unread={isChatUnread(item, rowReads, openHere)}
                onPress={() => {
                  Keyboard.dismiss();
                  openChat(item.connectionId, item.workspaceId, rowTitle(item));
                }}
                onLongPress={manage}
                onSwiped={markHintSeen}
                onRename={() => actions.renameChat(item)}
                onClose={() => actions.closeChat(item)}
              />
            );
          }}
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
            />
          }
        />
      )}
    </Screen>
  );
}

/** Every listed connection's read markers: the host's and each machine's. */
async function loadReads(db: Parameters<typeof loadThreadReads>[0], ids: string): Promise<ReadsByConnection> {
  const loaded = await Promise.all(ids.split('\n').map(async (id) => [id, await loadThreadReads(db, id)] as const));
  return new Map(loaded);
}
