import { Pressable, View } from 'react-native';

import { Text } from '@/components/Text';
import { formatFingerprint } from '@/lib/hostkey';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

/**
 * The host answered with a key that is not the pinned one.
 *
 * Deliberately not `ErrorBanner`: the generic banner reads as "try again", and
 * retrying is the one thing that must not be the obvious move here. It states
 * both readings — someone in the middle, or a server you rebuilt — shows the
 * pin so the key can be compared against the machine itself, and offers the one
 * route to the trust-reset flow. Nothing here re-pins anything.
 */
export function HostKeyChangedBanner({
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
