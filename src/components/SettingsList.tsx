import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, spacing } from '@/theme/tokens';

/**
 * The grouped-list primitives, promoted out of the settings route.
 *
 * They were local to that file until it grew four more sections and stopped
 * being a route. Nothing about them was settings-specific; they are the standard
 * platform anatomy — titled group, rows, hairline rules inset to the label — and
 * keeping them here is what lets a feature component render a section without
 * importing a screen.
 */

/**
 * The horizontal inset shared by every row, every section title and every
 * footer. Section cards do not pad; their contents do.
 */
export const ROW_INSET = spacing.md;

/**
 * A titled group of rows.
 *
 * The card carries no horizontal padding of its own — every row supplies
 * `ROW_INSET` instead, and so does the title. That is the whole alignment fix:
 * previously the card was padded and the title was not, so a heading sat 12pt to
 * the left of the labels it introduced. One inset, applied at the row level,
 * also lets a divider stop short of the label's left edge the way a system list
 * does, instead of cutting the full width of the card.
 */
export function Section({
  title,
  footer,
  tone = 'normal',
  children,
}: {
  title: string;
  footer?: string;
  /**
   * `danger` tints the group's title and rim red. The colour is the whole
   * warning — these rows sit alone at the bottom of the screen with nothing
   * above them to inherit context from.
   */
  tone?: 'normal' | 'danger';
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const danger = tone === 'danger';

  return (
    <View style={{ gap: spacing.sm }}>
      <Text
        variant="footnote"
        color={danger ? 'destructive' : 'secondary'}
        style={{ paddingHorizontal: ROW_INSET }}>
        {title}
      </Text>
      <View
        style={{
          borderRadius: radius.sm,
          backgroundColor: colors.secondarySystemBackground,
          // A hairline rim. The light scheme's card sits only a shade off its
          // canvas — enough separation to group, not enough to give the card an
          // edge — and without this it reads as a smudge rather than a surface.
          borderWidth: 1,
          borderColor: danger ? colors.destructive : colors.separator,
          // Matches a row's own vertical padding, so the space above the first
          // row equals the space between any two.
          paddingVertical: spacing.sm,
          overflow: 'hidden',
        }}>
        {children}
      </View>
      {footer !== undefined && (
        <Text variant="caption" color="secondary" style={{ paddingHorizontal: ROW_INSET }}>
          {footer}
        </Text>
      )}
    </View>
  );
}

/**
 * The rule between two rows, inset to the label's left edge.
 *
 * `marginVertical` matters as much as the line: rows pad themselves by
 * `spacing.sm` top and bottom, so a divider drawn flush would sit 8pt from the
 * text above and 8pt from the text below with no air of its own.
 */
export function Divider() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        height: 1,
        marginLeft: ROW_INSET,
        marginVertical: spacing.xxs,
        backgroundColor: colors.separator,
      }}
    />
  );
}

/**
 * A label and its value. Same inset, same vertical padding and same type size as
 * `Toggle`, because a reader scanning down a settings screen sees one column of
 * rows — not a switch list and, further down, a slightly smaller info list.
 */
export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={rowLayout}>
      <Text variant="body">{label}</Text>
      <Text variant="body" color="secondary" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/**
 * A row that does something when tapped.
 *
 * A row rather than a button inside a row: a tappable line in a grouped list is
 * a platform idiom people read without thinking, and the chevron says "this goes
 * somewhere" more quietly than a filled control would.
 */
export function ActionRow({
  label,
  detail,
  tone = 'normal',
  accessory = 'chevron',
  onPress,
  disabled = false,
  testID,
}: {
  label: string;
  detail?: string;
  tone?: 'normal' | 'tint' | 'destructive';
  /** `chevron` for navigation, `external` for something that leaves the app. */
  accessory?: 'chevron' | 'external' | 'none';
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const labelColor = tone === 'destructive' ? 'destructive' : tone === 'tint' ? 'tint' : 'label';
  const symbol: IconName | null =
    accessory === 'chevron' ? 'chevron.right' : accessory === 'external' ? 'arrow.up.right' : null;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={detail}
      testID={testID}
      style={({ pressed }) => ({
        ...rowLayout,
        backgroundColor: pressed ? colors.fillSubtle : 'transparent',
        opacity: disabled ? 0.4 : 1,
      })}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body" color={labelColor}>
          {label}
        </Text>
        {detail !== undefined && (
          <Text variant="footnote" color="secondary">
            {detail}
          </Text>
        )}
      </View>
      {symbol !== null && (
        <Icon
          name={symbol}
          size={13}
          tintColor={colors.tertiaryLabel}
          fallback={
            <Text variant="caption" color="tertiary">
              ›
            </Text>
          }
        />
      )}
    </Pressable>
  );
}

/** Shared by every row type, so a group reads as one column rather than a stack. */
const rowLayout = {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: spacing.md,
  paddingHorizontal: ROW_INSET,
  paddingVertical: spacing.sm,
  minHeight: minTouchTarget,
} as const;
