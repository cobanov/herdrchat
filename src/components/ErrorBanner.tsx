import { Pressable, View } from 'react-native';

import { Text } from './Text';
import { Icon } from './Icon';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

/**
 * What went wrong, in human language, plus the one action that might fix it.
 *
 * Inline rather than an alert: a connection error is a state the screen is in,
 * not an event to acknowledge, and an alert would have to be dismissed on every
 * failed poll.
 */
export function ErrorBanner({
  message,
  actionLabel,
  onAction,
  onDismiss,
}: {
  message: string;
  actionLabel?: string | null;
  onAction?: () => void;
  onDismiss?: () => void;
}) {
  const { colors } = useTheme();

  return (
    <View
      testID="error-banner"
      accessibilityRole="alert"
      style={{
        marginHorizontal: spacing.md,
        marginBottom: spacing.sm,
        padding: spacing.md,
        borderRadius: radius.sm,
        backgroundColor: colors.fillSubtle,
        gap: spacing.sm,
      }}>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Icon
          name="exclamationmark.triangle.fill"
          size={16}
          tintColor={colors.attention}
          fallback={<Text variant="footnote" color="attention">!</Text>}
        />
        <Text variant="footnote" color="secondary" style={{ flex: 1 }} numberOfLines={4}>
          {message}
        </Text>
        {onDismiss !== undefined && (
          <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={spacing.sm}>
            <Icon
              name="xmark.circle.fill"
              size={16}
              tintColor={colors.tertiaryLabel}
              fallback={<Text variant="footnote" color="tertiary">×</Text>}
            />
          </Pressable>
        )}
      </View>

      {actionLabel != null && onAction !== undefined && (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          testID="error-action"
          style={{ alignSelf: 'flex-start', paddingVertical: spacing.xs }}>
          <Text variant="footnote" color="tint" weight="600">
            {actionLabel}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
