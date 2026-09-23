import { Pressable, View } from 'react-native';

import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

const NAMES = { claude: 'Claude', codex: 'Codex' } as const;

/**
 * herdr on this host reports its Claude or Codex integration as out of date,
 * usually after a herdr upgrade (0.9.1 moved Claude's to v10). The fix is one
 * reinstall, which the banner offers; running agents pick it up the next time
 * they start or resume.
 */
export function IntegrationBanner({
  outdated,
  updating,
  error,
  onUpdate,
}: {
  outdated: readonly ('claude' | 'codex')[];
  updating: boolean;
  error: string | null;
  onUpdate: () => void;
}) {
  const { colors } = useTheme();
  const names = outdated.map((name) => NAMES[name]).join(' and ');

  return (
    <View
      testID="integration-banner"
      style={{
        marginHorizontal: spacing.md,
        marginBottom: spacing.sm,
        padding: spacing.md,
        borderRadius: radius.sm,
        backgroundColor: colors.fillSubtle,
        gap: spacing.sm,
      }}>
      <Text variant="subhead" weight="600">
        herdr&apos;s {names} integration is out of date
      </Text>
      <Text variant="footnote" color="secondary">
        This host&apos;s herdr was updated since the integration was installed. Update it so
        chats keep being recognised; running agents pick it up the next time they start or resume.
      </Text>
      {error !== null && (
        <Text variant="footnote" color="attention">
          {error}
        </Text>
      )}
      <Pressable
        onPress={onUpdate}
        disabled={updating}
        accessibilityRole="button"
        accessibilityLabel={`Update the ${names} integration`}
        accessibilityState={{ disabled: updating, busy: updating }}
        testID="integration-update"
        style={{ alignSelf: 'flex-start', paddingVertical: spacing.xs }}>
        <Text variant="footnote" color={updating ? 'secondary' : 'tint'} weight="600">
          {updating ? 'Updating…' : 'Update integration'}
        </Text>
      </Pressable>
    </View>
  );
}
