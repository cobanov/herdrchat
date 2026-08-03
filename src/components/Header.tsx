import * as Haptics from 'expo-haptics';
import { Platform, Pressable, View } from 'react-native';

import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, screenPadding, spacing } from '@/theme/tokens';

/**
 * The screen header. A large title with the current server underneath it, so
 * "which machine am I driving" is answered without opening anything — the single
 * most important piece of context in a multi-host app, and the one a plain
 * navigation title hides.
 */
export function Header({
  title,
  subtitle,
  onSubtitlePress,
  actionSymbol,
  actionLabel,
  onAction,
  onClose,
}: {
  title: string;
  subtitle?: string | null;
  onSubtitlePress?: () => void;
  actionSymbol?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  /**
   * Dismiss control for a modal screen. iOS gives sheets a drag-to-dismiss, but
   * that gesture is not reachable with VoiceOver or Switch Control, so a
   * presented screen needs a real button too.
   */
  onClose?: () => void;
}) {
  const { colors } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        paddingHorizontal: screenPadding,
        paddingTop: spacing.sm,
        paddingBottom: spacing.md,
        gap: spacing.sm,
        // The trailing controls are 44pt boxes around smaller glyphs, so the
        // glyph would otherwise sit ~14pt inside the margin the title starts at.
        // Pulling the row back by that difference optically aligns them.
        marginRight: -spacing.md,
      }}>
      <View style={{ flexShrink: 1 }}>
        <Text variant="largeTitle">{title}</Text>
        {subtitle != null && (
          <Pressable
            onPress={onSubtitlePress}
            accessibilityRole="button"
            accessibilityLabel={`Server: ${subtitle}. Manage servers.`}
            testID="server-switcher"
            hitSlop={spacing.sm}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Icon
              name="server.rack"
              size={13}
              tintColor={colors.secondaryLabel}
              fallback={<Text variant="caption">•</Text>}
            />
            <Text variant="subhead" color="secondary" weight="600">
              {subtitle}
            </Text>
            <Icon
              name="chevron.down"
              size={10}
              tintColor={colors.tertiaryLabel}
              fallback={<Text variant="caption2" color="tertiary">▾</Text>}
            />
          </Pressable>
        )}
      </View>

      {onClose !== undefined && (
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          testID="header-close"
          style={({ pressed }) => ({
            minWidth: minTouchTarget,
            height: minTouchTarget,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.5 : 1,
          })}>
          <Text variant="headline" color="tint">
            Done
          </Text>
        </Pressable>
      )}

      {actionSymbol !== undefined && onAction !== undefined && (
        <Pressable
          onPress={() => {
            if (Platform.OS === 'ios') void Haptics.selectionAsync();
            onAction();
          }}
          accessibilityRole="button"
          accessibilityLabel={actionLabel ?? 'Action'}
          testID="header-action"
          style={({ pressed }) => ({
            width: minTouchTarget,
            height: minTouchTarget,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.5 : 1,
          })}>
          <Icon
            name={actionSymbol}
            size={22}
            tintColor={colors.tint}
            fallback={<Text variant="title3" color="tint">+</Text>}
          />
        </Pressable>
      )}
    </View>
  );
}
