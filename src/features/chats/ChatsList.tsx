import { FlashList } from '@shopify/flash-list';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard, RefreshControl, ScrollView, TextInput, View } from 'react-native';

import { confirmDestructive } from '@/components/ActionSheet';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { openChat } from './navigation';
import { groupChats } from './chatGroups';
import { SkeletonRows } from '@/features/chats/SkeletonRows';
import { SwipeableChatRow } from '@/features/chats/SwipeableChatRow';
import { SwipeHint } from '@/features/chats/SwipeHint';
import { HostKeyChangedBanner } from '@/features/chats/HostKeyChangedBanner';
import { IntegrationBanner } from '@/features/chats/IntegrationBanner';
import { useOutdatedIntegrations } from '@/features/chats/useOutdatedIntegrations';
import { useAttentionBadge } from '@/features/chats/useAttentionBadge';
import { useChatActions } from '@/features/chats/useChatActions';
import { useWorkspaces } from '@/features/chats/useWorkspaces';
import { useTabPressHaptic } from '@/features/useTabPressHaptic';
import { connectionRecovery } from '@/lib/connectionRecovery';
import { haptics } from '@/lib/haptics';
import { isThreadUnread, type ThreadRead } from '@/lib/unread';
import { useChatEdits } from '@/state/chatEdits';
import { useChatSelection } from '@/state/chatSelection';
import {
  clientFor,
  loadHostKeyPin,
  newConnection,
  useSelectedConnection,
} from '@/state/connections';
import { loadThreadReads, setSetting } from '@/state/db';
import { encodeBool, useSettings } from '@/state/settings';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, screenPadding, size, spacing, typography } from '@/theme/tokens';

/**
 * Chats, the primary destination. One row per workspace, with live presence.
 *
 * Thin by design: everything it knows comes from `useWorkspaces`, everything it
 * draws comes from `ChatRow`, and everything it does to a workspace comes from
 * `useChatActions`.
 */
export default function ChatsList({ selectedWorkspaceId }: { selectedWorkspaceId?: string }) {
  const connection = useSelectedConnection();
  // Keyed by server: switching hosts is a different conversation list, not an
  // update to this one, so the whole thing remounts rather than being reset
  // field by field.
  return <ChatsForServer key={connection?.id ?? 'none'} selectedWorkspaceId={selectedWorkspaceId} />;
}

function ChatsForServer({ selectedWorkspaceId }: { selectedWorkspaceId?: string }) {
  const router = useRouter();
  const selection = useChatSelection((state) => state.selection);
  const select = useChatSelection((state) => state.select);
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const connection = useSelectedConnection();
  const client = useMemo(() => (connection === null ? null : clientFor(connection)), [connection]);

  const { summaries, loading, error, errorCode, herdrMissing, serverStopped, refresh } =
    useWorkspaces(client);
  const integrations = useOutdatedIntegrations(client);
  const [query, setQuery] = useState('');
  const rows = useMemo(() => groupChats(summaries, query), [summaries, query]);
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
  const [reads, setReads] = useState<Map<string, ThreadRead>>(new Map());
  useTabPressHaptic();

  const actions = useChatActions({
    client,
    connectionId: connection?.id ?? null,
    db,
    refresh,
    onClosed: useCallback((workspaceId: string) => {
      if (workspaceId === selectedWorkspaceId) select(null);
    }, [selectedWorkspaceId, select]),
  });

  // Renaming from the persistent sidebar must also update the open header.
  const selectedTitle = summaries.find((item) => item.workspaceId === selectedWorkspaceId)?.title;
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
      if (connection === null) return;
      void loadThreadReads(db, connection.id).then(setReads);
      // A rename happened in the sheet that just closed. Re-fetch rather than
      // wait out the poll, but only then, refreshing on every focus would cost
      // a round-trip each time you switch tabs.
      if (editsDirty) {
        clearEdits();
        void refresh();
      }
    }, [db, connection, editsDirty, clearEdits, refresh])
  );

  // The tablet list stays focused as its detail changes. Refresh read markers
  // after the previous detail has stamped its final read time on unmount.
  useEffect(() => {
    if (connection === null || selectedWorkspaceId === undefined) return;
    let alive = true;
    void loadThreadReads(db, connection.id).then((next) => { if (alive) setReads(next); });
    return () => { alive = false; };
  }, [db, connection, selectedWorkspaceId]);

  useAttentionBadge(summaries.filter((item) => item.workspaceId !== selectedWorkspaceId), reads, connection !== null);

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
   * The two things that can be fixed from here, and they are different sizes.
   *
   * Missing herdr downloads and runs an install script; a stopped server is one
   * process. Offering them as one button would make the smaller one feel as
   * consequential as the larger.
   */
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
      <Header
        title="Chats"
        subtitle={connection?.name ?? null}
        onSubtitlePress={() => router.navigate('/hosts')}
        actionSymbol="square.and.pencil"
        actionLabel="New chat"
        onAction={connection === null ? undefined : () => router.push('/new-chat')}
      />

      {/* Rename and close fail outside the poll's own error path, so they get
          their own banner, dismissible, because unlike a connection error this
          one is about an action that is over. */}
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
          <ErrorBanner
            message={error}
            actionLabel={
              fixing
                ? 'Working…'
                : herdrMissing
                  ? 'Install herdr on the host'
                  : serverStopped
                    ? 'Start herdr on the host'
                    : null
            }
            onAction={
              fixing
                ? undefined
                : herdrMissing
                  ? confirmInstallHerdr
                  : serverStopped
                    ? () => void fixHost('start')
                    : undefined
            }
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
          <SkeletonRows />
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
                onAction={fixing ? undefined : () => {
                  const { action } = connectionRecovery(errorCode ?? '');
                  if (action === 'install') confirmInstallHerdr();
                  else if (action === 'start') void fixHost('start');
                  else if (action === 'retry') void refresh();
                  else router.push({ pathname: '/server/[id]', params: { id: connection.id } });
                }}
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
          </ScrollView>
        )
      ) : (
        <FlashList
          data={rows}
          extraData={selectedWorkspaceId}
          keyExtractor={(item) => item.kind === 'group' ? `group-${item.id}` : item.summary.workspaceId}
          getItemType={(item) => item.kind}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          // The tab bar floats OVER the list, so the last row has to be able to
          // scroll clear of it. Without this the final chat sits under the bar
          // at the end of the list and cannot be read or tapped, however far you
          // scroll, there is nothing left to scroll.
          contentContainerStyle={{ paddingHorizontal: screenPadding, paddingBottom: size.floatingBarClearance }}
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
              {seenSwipeHint || rows.length === 0 ? null : <SwipeHint />}
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
            return (
              <SwipeableChatRow
                summary={item}
                selected={item.workspaceId === selectedWorkspaceId}
                unread={item.workspaceId !== selectedWorkspaceId && isThreadUnread(item.preview, item.sessionSig, reads.get(item.workspaceId))}
                onPress={() => {
                  Keyboard.dismiss();
                  openChat(connection.id, item.workspaceId, item.title);
                }}
                onLongPress={() => actions.manageChat(item)}
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
