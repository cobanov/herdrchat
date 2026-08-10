import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { PresenceAvatar } from '@/components/PresenceAvatar';
import { Text } from '@/components/Text';
import { useSelectedConnection } from '@/state/connections';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

/**
 * Whose settings these are, at the top of the screen.
 *
 * The checklist asks for an avatar, a name and an email — an account anchor. This
 * app has no account: it reaches machines you already own over SSH on your own
 * tailnet, and there is nobody to be signed in as.
 *
 * What it does have is the question that anchor actually answers — *which thing
 * am I configuring right now* — because almost everything below either belongs
 * to a host or is about talking to one. So the anchor is the selected host, at
 * the same place and doing the same job.
 */
export function HostCard() {
  const router = useRouter();
  const { colors } = useTheme();
  const connection = useSelectedConnection();

  if (connection === null) {
    return (
      <Pressable
        onPress={() => router.push('/hosts')}
        accessibilityRole="button"
        accessibilityLabel="No host selected. Add one."
        testID="settings-host-empty"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          padding: spacing.md,
          borderRadius: radius.sm,
          backgroundColor: colors.secondarySystemBackground,
          borderWidth: 1,
          borderColor: colors.separator,
          opacity: pressed ? 0.6 : 1,
        })}>
        <View style={{ flex: 1, gap: spacing.xxs }}>
          <Text variant="headline">No host yet</Text>
          <Text variant="caption" color="secondary">
            Add a machine that runs herdr to get started.
          </Text>
        </View>
        <Chevron />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => router.push('/hosts')}
      accessibilityRole="button"
      accessibilityLabel={`Connected to ${connection.name} as ${connection.username}. Switch hosts.`}
      testID="settings-host"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        padding: spacing.md,
        borderRadius: radius.sm,
        backgroundColor: colors.secondarySystemBackground,
        borderWidth: 1,
        borderColor: colors.separator,
        opacity: pressed ? 0.6 : 1,
      })}>
      {/* The same avatar the chat rows use, seeded on the host name. It is not
          decoration: two hosts with similar names are told apart by colour long
          before anyone reads the text. */}
      <PresenceAvatar colorKey={connection.name} status="idle" size={44} />
      <View style={{ flex: 1, gap: spacing.xxs }}>
        <Text variant="headline" numberOfLines={1}>
          {connection.name}
        </Text>
        <Text variant="caption" color="secondary" numberOfLines={1} mono>
          {connection.username}@{connection.host}:{connection.port}
        </Text>
      </View>
      <Chevron />
    </Pressable>
  );
}

function Chevron() {
  const { colors } = useTheme();
  return (
    <Icon
      name="chevron.right"
      size={13}
      tintColor={colors.tertiaryLabel}
      fallback={
        <Text variant="caption" color="tertiary">
          ›
        </Text>
      }
    />
  );
}
