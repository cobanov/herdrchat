import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { Header } from '@/components/Header';
import { Text } from '@/components/Text';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, spacing } from '@/theme/tokens';
import {
  clearSecrets,
  invalidateClient,
  newConnection,
  useConnections,
  type ServerConnection,
} from '@/state/connections';
import { deleteConnection, setSetting } from '@/state/db';
import { SELECTED_KEY } from '@/state/Hydrate';

/** Manage saved herdr hosts. Selecting one switches the whole app to it. */
export default function ServersScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const connections = useConnections((state) => state.connections);
  const selectedId = useConnections((state) => state.selectedId);
  const select = useConnections((state) => state.select);
  const remove = useConnections((state) => state.remove);

  const choose = async (connection: ServerConnection) => {
    select(connection.id);
    await setSetting(db, SELECTED_KEY, connection.id);
    // Straight back to the conversations on the host you just picked — choosing
    // a server is always in service of reading its chats.
    router.push('/');
  };

  const confirmDelete = (connection: ServerConnection) => {
    Alert.alert(
      `Remove ${connection.name}?`,
      'The saved key and cached chats for this server are deleted from this device. Nothing on the server changes.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await invalidateClient(connection.id);
              await clearSecrets(connection.id);
              await deleteConnection(db, connection.id);
              remove(connection.id);
            })();
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.systemBackground }} edges={['top']}>
      <Header
        title="Servers"
        actionSymbol="plus"
        actionLabel="Add a server"
        onAction={() =>
          router.push({ pathname: '/server/[id]', params: { id: newConnection().id, mode: 'new' } })
        }
      />

      {connections.length === 0 ? (
        <EmptyState
          symbol="server.rack"
          title="No servers yet"
          body="Add the machine that runs herdr. Connections go over SSH on your tailnet, so nothing is exposed publicly."
          actionLabel="Add a server"
          onAction={() =>
            router.push({ pathname: '/server/[id]', params: { id: newConnection().id, mode: 'new' } })
          }
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: screenPadding, gap: spacing.sm }}>
          {connections.map((connection) => (
            <View
              key={connection.id}
              style={{
                borderRadius: radius.sm,
                backgroundColor: colors.secondarySystemBackground,
                overflow: 'hidden',
              }}>
              <Pressable
                onPress={() => void choose(connection)}
                accessibilityRole="button"
                accessibilityLabel={`Use ${connection.name}`}
                accessibilityState={{ selected: connection.id === selectedId }}
                testID={`server-${connection.id}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  padding: spacing.md,
                  opacity: pressed ? 0.6 : 1,
                })}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="headline">{connection.name}</Text>
                  <Text variant="caption" color="secondary">
                    {connection.username}@{connection.host}:{connection.port}
                  </Text>
                </View>
                {connection.id === selectedId && (
                  <Icon
                    name="checkmark"
                    size={16}
                    tintColor={colors.tint}
                    fallback={<Text color="tint">✓</Text>}
                  />
                )}
              </Pressable>

              <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.separator }}>
                <RowAction
                  label="Edit"
                  onPress={() =>
                    router.push({ pathname: '/server/[id]', params: { id: connection.id } })
                  }
                />
                <View style={{ width: 1, backgroundColor: colors.separator }} />
                <RowAction label="Remove" destructive onPress={() => confirmDelete(connection)} />
              </View>
            </View>
          ))}

          <Text variant="footnote" color="secondary" style={{ padding: spacing.md }}>
            Keys and passwords are stored in the device keychain, never in the database. The first
            time you connect, the server’s host key is pinned; if it ever changes, the connection is
            refused until you save the server again.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function RowAction({
  label,
  onPress,
  destructive = false,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        paddingVertical: spacing.md,
        alignItems: 'center',
        opacity: pressed ? 0.5 : 1,
      })}>
      <Text variant="subhead" color={destructive ? 'destructive' : 'tint'} weight="600">
        {label}
      </Text>
    </Pressable>
  );
}
