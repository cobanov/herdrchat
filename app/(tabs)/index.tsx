import { FlashList } from '@shopify/flash-list';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';

import { confirmDestructive, showActionSheet } from '@/components/ActionSheet';
import { EmptyState } from '@/components/EmptyState';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { CHAT_ROW_TEXT_INSET } from '@/features/chats/ChatRow';
import { SwipeableChatRow } from '@/features/chats/SwipeableChatRow';
import { SwipeHint } from '@/features/chats/SwipeHint';
import type { ChatSummary } from '@/features/chats/useWorkspaces';
import { errorText, summaryNeedsAttention, useWorkspaces } from '@/features/chats/useWorkspaces';
import { ErrorBanner } from '@/components/ErrorBanner';
import { isThreadUnread, type ThreadRead } from '@/lib/unread';
import { useBadge } from '@/state/badge';
import { useChatEdits } from '@/state/chatEdits';
import { clientFor, newConnection, useSelectedConnection } from '@/state/connections';
import { loadThreadReads, setSetting } from '@/state/db';
import { forgetWorkspace } from '@/state/threadCache';
import { haptics } from '@/lib/haptics';
import { encodeBool, useSettings } from '@/state/settings';
import { useTabPressHaptic } from '@/features/useTabPressHaptic';
import { useTheme } from '@/theme/ThemeProvider';
import { screenPadding, spacing } from '@/theme/tokens';

/**
 * Chats — the primary destination. One row per workspace, with live presence.
 *
 * Thin by design: everything it knows comes from `useWorkspaces`, and everything
 * it draws comes from `ChatRow`.
 */
export default function ChatsScreen() {
  const connection = useSelectedConnection();
  // Keyed by server: switching hosts is a different conversation list, not an
  // update to this one, so the whole thing remounts rather than being reset
  // field by field.
  return <ChatsForServer key={connection?.id ?? 'none'} />;
}

function ChatsForServer() {
  const router = useRouter();
  const { colors } = useTheme();
  const connection = useSelectedConnection();
  const client = useMemo(() => (connection === null ? null : clientFor(connection)), [connection]);

  const { summaries, loading, error, herdrMissing, refresh } = useWorkspaces(client);
  const [installing, setInstalling] = useState(false);

  const db = useSQLiteContext();
  useTabPressHaptic();
  // Failures from rename/close, which happen outside the poll's own error path.
  const [actionError, setActionError] = useState<string | null>(null);
  const [reads, setReads] = useState<Map<string, ThreadRead>>(new Map());
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
      // wait out the poll, but only then — refreshing on every focus would cost
      // a round-trip each time you switch tabs.
      if (editsDirty) {
        clearEdits();
        void refresh();
      }
    }, [db, connection, editsDirty, clearEdits, refresh])
  );

  /**
   * Close a chat on the host.
   *
   * Destructive on the HOST, not just in the app — it stops every tab, pane and
   * running process in the workspace — so the confirmation says that in those
   * words rather than asking a vague "are you sure".
   */
  const closeChat = useCallback(
    (summary: ChatSummary) => {
      if (client === null || connection === null) return;
      confirmDestructive({
        title: `Close ${summary.title}?`,
        message:
          'Every tab, pane and running process in this workspace stops. The conversation stays on disk, but the agent does not.',
        confirmLabel: 'Close chat',
        onConfirm: () => {
          void client
            .closeWorkspace(summary.workspaceId)
            // Drop the cache too: herdr recycles workspace ids, and the next
            // chat to land in this slot must not open showing this one's
            // messages.
            .then(() => forgetWorkspace(db, connection.id, summary.workspaceId))
            .then(refresh)
            .catch((thrown: unknown) => setActionError(errorText(thrown)));
        },
      });
    },
    [client, connection, db, refresh]
  );

  const renameChat = useCallback(
    (summary: ChatSummary) => {
      router.push({
        pathname: '/rename-chat',
        params: { workspaceId: summary.workspaceId, title: summary.title },
      });
    },
    [router]
  );

  /**
   * The same two actions the row's swipe offers, as a long-press menu.
   *
   * Both affordances on purpose. The swipe is faster once you know it is there,
   * and the long press is the one a person finds by trying things — an action
   * reachable only by a gesture is an action most people never reach.
   */
  const manageChat = useCallback(
    (summary: ChatSummary) => {
      if (client === null) return;
      haptics.medium();
      showActionSheet({
        title: summary.title,
        actions: [
          { label: 'Rename\u2026', onPress: () => renameChat(summary) },
          { label: 'Close chat', destructive: true, onPress: () => closeChat(summary) },
        ],
      });
    },
    [client, renameChat, closeChat]
  );

  const installHerdr = async () => {
    if (client === null) return;
    setInstalling(true);
    try {
      await client.installHerdr();
      await refresh();
    } finally {
      setInstalling(false);
    }
  };

  /**
   * Publish the attention count for the tab bar's badge.
   *
   * Computed here because the number is already in hand — the alternative is a
   * second poll in the tab layout, which would double every host's round-trips
   * to learn something this screen recalculated a moment ago.
   */
  const attention = useMemo(
    () =>
      summaries.filter(
        (summary) =>
          summaryNeedsAttention(summary) ||
          isThreadUnread(summary.preview, summary.sessionSig, reads.get(summary.workspaceId))
      ).length,
    [summaries, reads]
  );
  // An effect, not a render-phase write: publishing to a store outside React's
  // tree is a side effect, and doing it during render is the kind of thing that
  // works until concurrent rendering retries a render.
  useEffect(() => {
    useBadge.getState().setCount(connection === null ? 0 : attention);
  }, [attention, connection]);

  /**
   * The hint stops the first time the gesture is used, so it teaches rather than
   * expires. Persisted alongside the settings it lives next to, and written
   * through the same store-plus-mirror path everything else uses.
   */
  const seenSwipeHint = useSettings((state) => state.seenSwipeHint);
  const markHintSeen = useCallback(() => {
    if (useSettings.getState().seenSwipeHint) return;
    useSettings.getState().set('seenSwipeHint', true);
    void setSetting(db, 'seenSwipeHint', encodeBool(true));
  }, [db]);

  return (
    <Screen>
      <Header
        title="Chats"
        subtitle={connection?.name ?? null}
        onSubtitlePress={() => router.push('/hosts')}
        actionSymbol="square.and.pencil"
        actionLabel="New chat"
        onAction={connection === null ? undefined : () => router.push('/new-chat')}
      />

      {/* Rename and close fail outside the poll's own error path, so they get
          their own banner — dismissible, because unlike a connection error this
          one is about an action that is over. */}
      {actionError !== null && (
        <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
      )}

      {error !== null && (
        <ErrorBanner
          message={error}
          actionLabel={herdrMissing ? (installing ? 'Installing…' : 'Install herdr on the host') : null}
          onAction={herdrMissing && !installing ? () => void installHerdr() : undefined}
        />
      )}

      {connection === null ? (
        <EmptyState
          symbol="server.rack"
          title="No hosts yet"
          body="Add a machine that runs herdr. HerdrChat reaches it over SSH on your tailnet — nothing is exposed publicly."
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
          <EmptyState
            symbol="tray"
            title="No workspaces"
            body={`Workspaces you open in herdr on ${connection.name} appear here.`}
            actionLabel="Start a chat"
            onAction={() => router.push('/new-chat')}
          />
        )
      ) : (
        <FlashList
          data={summaries}
          keyExtractor={(item) => item.workspaceId}
          ListHeaderComponent={seenSwipeHint ? null : <SwipeHint />}
          renderItem={({ item }) => (
            <SwipeableChatRow
              summary={item}
              unread={isThreadUnread(item.preview, item.sessionSig, reads.get(item.workspaceId))}
              onPress={() =>
                router.push({
                  pathname: '/chat/[workspaceId]',
                  params: { workspaceId: item.workspaceId, title: item.title },
                })
              }
              onLongPress={() => manageChat(item)}
              onRename={() => {
                markHintSeen();
                renameChat(item);
              }}
              onClose={() => {
                markHintSeen();
                closeChat(item);
              }}
            />
          )}
          ItemSeparatorComponent={() => (
            // Starts where the row's text starts, not at an arbitrary offset.
            <View
              style={{
                height: 1,
                marginLeft: CHAT_ROW_TEXT_INSET,
                backgroundColor: colors.separator,
                opacity: 0.6,
              }}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={false}
              // Felt at the moment the pull commits, not when data lands. Every
              // refresh is an SSH round-trip over a tailnet, so there is a beat
              // before anything changes — and your thumb is over the spinner.
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

/**
 * A shaped skeleton rather than a bare spinner: the row layout is known, so
 * showing it stops the list from jumping when data lands.
 */
function SkeletonRows() {
  const { colors } = useTheme();
  return (
    <View style={{ paddingHorizontal: screenPadding, paddingTop: spacing.sm, gap: spacing.lg }}>
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View
            style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.fillSubtle }}
          />
          <View style={{ flex: 1, gap: spacing.sm }}>
            <View style={{ height: 14, width: '45%', borderRadius: 7, backgroundColor: colors.fillSubtle }} />
            <View style={{ height: 12, width: '75%', borderRadius: 6, backgroundColor: colors.fillSubtle }} />
          </View>
        </View>
      ))}
      <Text variant="footnote" color="tertiary" style={{ textAlign: 'center' }}>
        Connecting…
      </Text>
    </View>
  );
}
