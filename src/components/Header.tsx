import * as Haptics from 'expo-haptics';
import { Platform, Pressable, View } from 'react-native';

import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import { useTheme } from '@/theme/ThemeProvider';
import { headerTitleLine, minTouchTarget, screenPadding, spacing } from '@/theme/tokens';

/**
 * The screen header: a large title, an optional server line under it, and at
 * most one trailing control.
 *
 * The title sits at the SAME y on every screen. That is the whole reason this
 * is one component rather than per-screen markup — the previous version
 * bottom-aligned the row, so a screen with a subtitle (Chats) and one without
 * (Settings, Hosts) put their titles at different heights, and switching tabs
 * made the heading jump. Here the title is pinned to the top of a fixed-height
 * line and the subtitle hangs beneath it, so adding or removing a subtitle
 * changes what is under the title, never where the title is.
 *
 * Trailing controls are centred on that same line, so they align with the title
 * rather than with whatever happens to be the tallest thing in the row.
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
    <View style={{ paddingHorizontal: screenPadding, paddingTop: spacing.sm, paddingBottom: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: headerTitleLine }}>
        <Text variant="largeTitle" numberOfLines={1} style={{ flexShrink: 1 }}>
          {title}
        </Text>
        <View style={{ flex: 1 }} />

        {onClose !== undefined && (
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            testID="header-close"
            hitSlop={spacing.sm}
            style={({ pressed }) => ({
              minWidth: minTouchTarget,
              height: minTouchTarget,
              alignItems: 'flex-end',
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
            // The 44pt target is met with hitSlop rather than a 44pt box, so the
            // glyph itself can sit flush with the screen margin the title uses.
            // A padded box would inset it by 11pt and break that alignment.
            hitSlop={spacing.md}
            style={({ pressed }) => ({
              height: minTouchTarget,
              alignItems: 'flex-end',
              justifyContent: 'center',
              opacity: pressed ? 0.5 : 1,
            })}>
            <Icon
              name={actionSymbol}
              size={24}
              tintColor={colors.tint}
              fallback={
                <Text variant="title3" color="tint">
                  +
                </Text>
              }
            />
          </Pressable>
        )}
      </View>

      {subtitle != null && (
        <Pressable
          onPress={onSubtitlePress}
          accessibilityRole="button"
          accessibilityLabel={`Host: ${subtitle}. Switch hosts.`}
          testID="server-switcher"
          hitSlop={spacing.sm}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start' }}>
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
            fallback={
              <Text variant="caption2" color="tertiary">
                ▾
              </Text>
            }
          />
        </Pressable>
      )}
    </View>
  );
}
