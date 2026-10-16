import { Pressable, View } from 'react-native';

import { Text } from '@/components/Text';
import type { IntegrationIssue } from '@/lib/herdr/client';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

const NAMES = { claude: 'Claude', codex: 'Codex', pi: 'Pi', omp: 'OMP' } as const;

/**
 * herdr on this host reports a chat-agent integration as out of date, usually
 * after a herdr upgrade, or as never installed for an agent the host has.
 * Without it the agent never reports its session and its chat waits forever.
 * The fix is one install, which the banner offers; running agents pick it up
 * the next time they start or resume.
 */
export function IntegrationBanner({
  issues,
  updating,
  error,
  onUpdate,
}: {
  issues: readonly IntegrationIssue[];
  updating: boolean;
  error: string | null;
  onUpdate: () => void;
}) {
  const { colors } = useTheme();
  const names = issues.map((issue) => NAMES[issue.name]).join(' and ');
  const missing = issues.some((issue) => issue.state === 'missing');

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
        {missing ? `herdr's ${names} integration isn't installed` : `herdr's ${names} integration is out of date`}
      </Text>
      <Text variant="footnote" color="secondary">
        {missing
          ? "Without it this host's agents never report their session, so their chats wait forever. Install it; running agents pick it up the next time they start or resume."
          : "This host's herdr was updated since the integration was installed. Update it so chats keep being recognised; running agents pick it up the next time they start or resume."}
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
        accessibilityLabel={`${missing ? 'Install' : 'Update'} the ${names} integration`}
        accessibilityState={{ disabled: updating, busy: updating }}
        testID="integration-update"
        style={{ alignSelf: 'flex-start', paddingVertical: spacing.xs }}>
        <Text variant="footnote" color={updating ? 'secondary' : 'tint'} weight="600">
          {updating ? (missing ? 'Installing…' : 'Updating…') : missing ? 'Install integration' : 'Update integration'}
        </Text>
      </Pressable>
    </View>
  );
}
