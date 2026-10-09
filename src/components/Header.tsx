import { Pressable, View } from 'react-native';

import { Text } from './Text';
import { haptics } from '@/lib/haptics';
import { Icon, type IconName } from './Icon';
import { useTheme } from '@/theme/ThemeProvider';
import { headerTitleLine, minTouchTarget, screenPadding, spacing, useScaledLine } from '@/theme/tokens';

/**
 * The screen header: a large title, an optional server line under it, and up to
 * two trailing glyph controls (an action and a menu) plus a dismiss control for
 * a sheet.
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
 *
 * Two glyphs, not a slot for any number: Chats needs "+" and the menu that
 * replaced the tab bar, and a third control on a phone-width title line starts
 * truncating the title. The menu sits outermost, where the trailing edge of a
 * system navigation bar puts its "more" control, so the "+" keeps the place it
 * has always had relative to the title.
 */
export function Header({
  title,
  subtitle,
  onSubtitlePress,
  actionSymbol,
  actionLabel,
  onAction,
  menuSymbol = 'ellipsis.circle',
  menuLabel = 'Menu',
  menuTestID = 'header-menu',
  onMenu,
  onClose,
  closeLabel = 'Done',
}: {
  title: string;
  subtitle?: string | null;
  onSubtitlePress?: () => void;
  actionSymbol?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  /** A second trailing control, outermost: the screen's menu. */
  menuSymbol?: IconName;
  menuLabel?: string;
  menuTestID?: string;
  onMenu?: () => void;
  /**
   * Dismiss control for a modal screen. iOS gives sheets a drag-to-dismiss, but
   * that gesture is not reachable with VoiceOver or Switch Control, so a
   * presented screen needs a real button too.
   */
  onClose?: () => void;
  /**
   * What the dismiss control says. "Done" reads as "keep what I did", so a
   * form whose close throws the input away says "Cancel" instead: people
   * filled a new host, tapped Done and lost it.
   */
  closeLabel?: string;
}) {
  const { colors } = useTheme();
  const titleLine = useScaledLine(headerTitleLine);

  return (
    <View style={{ paddingHorizontal: screenPadding, paddingTop: spacing.sm, paddingBottom: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: titleLine }}>
        <Text variant="largeTitle" numberOfLines={1} style={{ flexShrink: 1 }}>
          {title}
        </Text>
        <View style={{ flex: 1 }} />

        {onClose !== undefined && (
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            // The label a person reads is the one Voice Control listens for.
            // "Close" here while the screen said "Done" left "Tap Done" with
            // nothing to find (#112).
            accessibilityLabel={closeLabel}
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
              {closeLabel}
            </Text>
          </Pressable>
        )}

        {actionSymbol !== undefined && onAction !== undefined && (
          <GlyphButton symbol={actionSymbol} label={actionLabel ?? 'Action'} testID="header-action" fallback="+" onPress={onAction} />
        )}

        {/* Twice the glyphs' hitSlop apart, so their 44pt targets meet at the
            midpoint instead of overlapping: a tap between "+" and the menu
            goes to whichever glyph it is nearer. */}
        {onMenu !== undefined && (
          <View style={{ marginLeft: actionSymbol !== undefined && onAction !== undefined ? spacing.xl : 0 }}>
            <GlyphButton symbol={menuSymbol} label={menuLabel} testID={menuTestID} fallback="…" onPress={onMenu} />
          </View>
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

/** One trailing glyph control. Felt as a selection, like every header action. */
function GlyphButton({
  symbol,
  label,
  testID,
  fallback,
  onPress,
}: {
  symbol: IconName;
  label: string;
  testID: string;
  fallback: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
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
        name={symbol}
        size={24}
        tintColor={colors.tint}
        fallback={
          <Text variant="title3" color="tint">
            {fallback}
          </Text>
        }
      />
    </Pressable>
  );
}
