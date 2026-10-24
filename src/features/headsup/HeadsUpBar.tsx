import { Pressable, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import { barLine, barText, type HeadsUpItem } from '@/lib/headsup/items';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, screenPadding, size, spacing } from '@/theme/tokens';

/**
 * The chats' Heads Up line, under the title: what the mod's band above the
 * prompt says, `⚑ 1 blocking · 4 need you · 2 questions · …`, summed over
 * every listed host that runs it, the blocking count in the attention colour.
 * A tap opens the list. Nothing at all when nothing is open, which is also
 * every host without the mod.
 *
 * Its own sign, not folded into the "need you" count of chats: a chat that
 * needs you is waiting at its prompt; an item may be from a session that has
 * long moved on.
 */
export function HeadsUpBar({ items, onPress }: { items: readonly HeadsUpItem[]; onPress: () => void }) {
  const { colors } = useTheme();
  const bar = barText(items);
  if (bar === null) return null;
  return (
    <View style={{ paddingHorizontal: screenPadding, paddingBottom: spacing.sm }}>
      <Pressable
        testID="headsup-bar"
        accessibilityRole="button"
        accessibilityLabel={barLine(bar)}
        accessibilityHint="Opens Heads Up"
        onPress={() => {
          haptics.selection();
          onPress();
        }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          minHeight: minTouchTarget,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderRadius: radius.sm,
          backgroundColor: pressed ? colors.chatCardPressed : colors.chatCard,
        })}>
        <Text variant="footnote" style={{ flex: 1, minWidth: 0 }}>
          <Text variant="footnote" color={bar.blocking === null ? 'label' : 'attention'} weight="600">
            {bar.blocking === null ? '⚑ ' : `⚑ ${bar.blocking} · `}
          </Text>
          <Text variant="footnote" weight="600">{bar.needYou}</Text>
          <Text variant="footnote" color="secondary">{` · ${bar.counts}`}</Text>
        </Text>
        <Icon name="chevron.right" size={size.rowChevron} tintColor={colors.tertiaryLabel} />
      </Pressable>
    </View>
  );
}
