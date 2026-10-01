import * as Linking from 'expo-linking';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import { REPO_URL } from '@/lib/welcome';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

/**
 * A polite request for a GitHub star: what the app is, why a star helps, one
 * button. Shown on the welcome's last page and once in the chat list after a
 * few days of use; `onDismiss` gives the latter its "Not now".
 */
export function StarCard({ onStar, onDismiss, testID }: { onStar?: () => void; onDismiss?: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        padding: spacing.lg,
        gap: spacing.md,
        borderRadius: radius.md,
        backgroundColor: colors.secondarySystemBackground,
        borderWidth: 1,
        borderColor: colors.separator,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon name="star.fill" size={16} tintColor={colors.attention} fallback={<Text color="attention">★</Text>} />
        <Text variant="headline">Free and open source</Text>
      </View>
      <Text variant="subhead" color="secondary">
        HerdrChat is free, open source and has no ads or accounts. If it saves you a trip to your desk, a star on
        GitHub helps other people find it.
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
        <Pressable
          onPress={() => {
            haptics.light();
            void Linking.openURL(REPO_URL);
            onStar?.();
          }}
          accessibilityRole="link"
          accessibilityLabel="Star HerdrChat on GitHub"
          testID="star-on-github"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm,
            borderRadius: radius.full,
            backgroundColor: pressed ? colors.fillSubtle : colors.tintMuted,
          })}>
          <Icon name="star.fill" size={14} tintColor={colors.tint} fallback={<Text color="tint">★</Text>} />
          <Text variant="subhead" weight="600" color="tint">
            Star on GitHub
          </Text>
        </Pressable>
        {onDismiss !== undefined && (
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Not now"
            testID="star-not-now"
            hitSlop={spacing.sm}
            style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
            <Text variant="subhead" color="secondary">
              Not now
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
