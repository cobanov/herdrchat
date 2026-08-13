import { FlashList } from '@shopify/flash-list';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';

import { confirmDestructive } from '@/components/ActionSheet';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { CHAT_ROW_TEXT_INSET } from '@/features/chats/ChatRow';
import { SkeletonRows } from '@/features/chats/SkeletonRows';
import { SwipeableChatRow } from '@/features/chats/SwipeableChatRow';
import { SwipeHint } from '@/features/chats/SwipeHint';
import { useAttentionBadge } from '@/features/chats/useAttentionBadge';
import { useChatActions } from '@/features/chats/useChatActions';
import { useWorkspaces } from '@/features/chats/useWorkspaces';
import { useTabPressHaptic } from '@/features/useTabPressHaptic';
import { haptics } from '@/lib/haptics';
import { formatFingerprint, isHostKeyChangedMessage } from '@/lib/hostkey';
import { isThreadUnread, type ThreadRead } from '@/lib/unread';
import { useChatEdits } from '@/state/chatEdits';
import {
  clientFor,
  loadHostKeyPin,
  newConnection,
  useSelectedConnection,
} from '@/state/connections';
import { loadThreadReads, setSetting } from '@/state/db';
import { encodeBool, useSettings } from '@/state/settings';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

/**
 * Chats — the primary destination. One row per workspace, with live presence.
 *
 * Thin by design: everything it knows comes from `useWorkspaces`, everything it
 * draws comes from `ChatRow`, and everything it does to a workspace comes from
 * `useChatActions`.
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
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const connection = useSelectedConnection();
  const client = useMemo(() => (connection === null ? null : clientFor(connection)), [connection]);

  const { summaries, loading, error, herdrMissing, serverStopped, refresh } = useWorkspaces(client);
  /** One flag for both recovery actions — only one is ever offered at a time. */
  const [fixing, setFixing] = useState(false);
  // A key change is not one failure among many: it is the only one where the
  // right move might be to stop using the app. It gets its own surface.
  const keyChanged = isHostKeyChangedMessage(error);
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
  });

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

  useAttentionBadge(summaries, reads, connection !== null);

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
   * runs — the same bargain a terminal would offer, where you would at least
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
        onSubtitlePress={() => router.push('/hosts')}
        actionSymbol="square.and.pencil"
        actionLabel="New chat"
        onAction={connection === null ? undefined : () => router.push('/new-chat')}
      />

      {/* Rename and close fail outside the poll's own error path, so they get
          their own banner — dismissible, because unlike a connection error this
          one is about an action that is over. */}
      {actions.error !== null && (
        <ErrorBanner message={actions.error} onDismiss={actions.clearError} />
      )}

      {error !== null &&
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
              onLongPress={() => actions.manageChat(item)}
              onSwiped={markHintSeen}
              onRename={() => actions.renameChat(item)}
              onClose={() => actions.closeChat(item)}
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
 * The host answered with a key that is not the pinned one.
 *
 * Deliberately not `ErrorBanner`: the generic banner reads as "try again", and
 * retrying is the one thing that must not be the obvious move here. It states
 * both readings — someone in the middle, or a server you rebuilt — shows the
 * pin so the key can be compared against the machine itself, and offers the one
 * route to the trust-reset flow. Nothing here re-pins anything.
 */
function HostKeyChangedBanner({
  pin,
  onOpenEditor,
}: {
  pin: string | null;
  onOpenEditor: () => void;
}) {
  const { colors } = useTheme();

  return (
    <View
      testID="host-key-changed-banner"
      accessibilityRole="alert"
      style={{
        marginHorizontal: spacing.md,
        marginBottom: spacing.sm,
        padding: spacing.md,
        borderRadius: radius.sm,
        backgroundColor: colors.fillSubtle,
        gap: spacing.sm,
      }}>
      <Text variant="subhead" weight="600" color="attention">
        This host’s SSH key changed
      </Text>
      <Text variant="footnote" color="secondary">
        Either the server was reinstalled or re-keyed, or something is
        intercepting the connection. Until you know which, treat it as the second
        one.
      </Text>
      {pin !== null && (
        <Text variant="caption" color="tertiary" mono selectable>
          Pinned: {formatFingerprint(pin)}
        </Text>
      )}
      <Pressable
        onPress={onOpenEditor}
        accessibilityRole="button"
        accessibilityLabel="Open host settings"
        testID="host-key-changed-action"
        style={{ alignSelf: 'flex-start', paddingVertical: spacing.xs }}>
        <Text variant="footnote" color="tint" weight="600">
          Open host settings
        </Text>
      </Pressable>
    </View>
  );
}
