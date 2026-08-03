import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { Header } from '@/components/Header';
import { Text } from '@/components/Text';
import { ChatRow } from '@/features/chats/ChatRow';
import { useWorkspaces } from '@/features/chats/useWorkspaces';
import { ErrorBanner } from '@/components/ErrorBanner';
import { clientFor, newConnection, useSelectedConnection } from '@/state/connections';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.systemBackground }} edges={['top']}>
      <Header
        title="Chats"
        subtitle={connection?.name ?? null}
        onSubtitlePress={() => router.push('/servers')}
        actionSymbol="square.and.pencil"
        actionLabel="New chat"
        onAction={connection === null ? undefined : () => router.push('/new-chat')}
      />

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
          title="No servers yet"
          body="Add the machine that runs herdr. HerdrChat reaches it over SSH on your tailnet — nothing is exposed publicly."
          actionLabel="Add a server"
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
          renderItem={({ item }) => (
            <ChatRow
              summary={item}
              unread={false}
              onPress={() =>
                router.push({
                  pathname: '/chat/[workspaceId]',
                  params: { workspaceId: item.workspaceId, title: item.title },
                })
              }
            />
          )}
          ItemSeparatorComponent={() => (
            <View
              style={{
                height: 1,
                marginLeft: 84,
                backgroundColor: colors.separator,
                opacity: 0.5,
              }}
            />
          )}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={() => void refresh()} tintColor={colors.tint} />
          }
        />
      )}
    </SafeAreaView>
  );
}

/**
 * A shaped skeleton rather than a bare spinner: the row layout is known, so
 * showing it stops the list from jumping when data lands.
 */
function SkeletonRows() {
  const { colors } = useTheme();
  return (
    <View style={{ padding: spacing.md, gap: spacing.lg }}>
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
