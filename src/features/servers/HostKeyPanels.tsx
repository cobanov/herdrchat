import { View } from 'react-native';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { formatFingerprint } from '@/lib/hostkey';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

/**
 * The two host-key surfaces on the server editor.
 *
 * Both are presentational — everything they know arrives as props — which is
 * why they are here and not inline in the route. See CLAUDE.md on route
 * thinness.
 */

/**
 * The test reached the host, and it answered with a key that is not the pinned
 * one.
 *
 * The wording leads with the innocent explanation and then refuses to settle
 * on it, because at this point the app genuinely cannot tell the two apart. The
 * action is a deliberate one-way door, labelled as trust rather than as retry.
 */
export function KeyChangedPanel({ message, onTrust }: { message: string; onTrust: () => void }) {
  const { colors } = useTheme();

  return (
    <View
      style={{
        padding: spacing.md,
        borderRadius: radius.sm,
        backgroundColor: colors.fillSubtle,
        gap: spacing.sm,
      }}>
      <Text variant="subhead" weight="600" testID="test-key-changed">
        The host identifies with a different key
      </Text>
      <Text variant="footnote" color="secondary">
        {message}
      </Text>
      <Text variant="footnote" color="secondary">
        If you did not reinstall or re-key this server, stop here — something between you and it
        could be intercepting the connection.
      </Text>
      <Button title="Trust the new key" variant="tinted" onPress={onTrust} />
    </View>
  );
}

/**
 * The key this host is bound to, or the one a test just accepted.
 *
 * Selectable and monospaced because its only real use is being compared,
 * character by character, against `ssh-keygen -lf` on the machine itself.
 */
export function HostFingerprint({ fingerprint }: { fingerprint: string }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="caption" color="secondary">
        Host key fingerprint
      </Text>
      <Text variant="caption" color="tertiary" mono selectable testID="host-fingerprint">
        {formatFingerprint(fingerprint)}
      </Text>
    </View>
  );
}
