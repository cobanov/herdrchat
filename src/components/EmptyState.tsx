import { ScrollView, View } from 'react-native';

import { Button } from './Button';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, size, spacing, useScaledLine } from '@/theme/tokens';

/**
 * An empty state: an icon, one line of explanation, one clear action.
 *
 * Deliberately not a shrug — every empty state in this app is a place where the
 * user can do something, so the action is required rather than optional wherever
 * one exists.
 *
 * A SCROLL VIEW, which looks like overkill for four elements and is not. This
 * was a centred `flex: 1` box, and at the largest accessibility text size its
 * content was taller than the screen — so the icon overlapped the header, the
 * title ran off the right edge, and the button this component exists to offer
 * was below the fold with no way to reach it. An empty state whose only action
 * is unreachable is worse than an empty screen.
 *
 * `flexGrow: 1` with `justifyContent: 'center'` is the pattern that gets both:
 * centred while it fits, scrollable the moment it does not.
 */
export function EmptyState({
  symbol,
  title,
  body,
  actionLabel,
  onAction,
}: {
  symbol: IconName;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();
  // The symbol grows with the text it sits above. A 44pt glyph over 60pt type
  // reads as a bullet point rather than an illustration.
  const glyph = useScaledLine(minTouchTarget);

  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.xxl,
        // Clears the floating tab bar, which overlays this rather than sitting
        // beneath it — without this the action ends up underneath the bar at the
        // exact sizes where it is already hardest to reach.
        paddingBottom: size.floatingBarClearance,
        gap: spacing.md,
      }}>
      <Icon
        name={symbol}
        size={glyph}
        tintColor={colors.tertiaryLabel}
        fallback={<Text variant="largeTitle" color="tertiary">◦</Text>}
      />
      <Text variant="title3" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      <Text variant="subhead" color="secondary" style={{ textAlign: 'center' }}>
        {body}
      </Text>
      {actionLabel !== undefined && onAction !== undefined && (
        <View style={{ marginTop: spacing.sm }}>
          <Button title={actionLabel} onPress={onAction} />
        </View>
      )}
    </ScrollView>
  );
}
