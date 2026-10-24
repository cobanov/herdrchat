import { Pressable, View } from 'react-native';

import { Glass } from '@/components/Glass';
import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import { chatItemLabel, type HeadsUpItem } from '@/lib/headsup/items';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, size, spacing } from '@/theme/tokens';

/**
 * A chat's own Heads Up items, above the composer: the open questions and
 * follow-ups its Claude session logged, the blocking one first. Answer puts
 * the mod's reply tag in the composer, so the reply is sent as any message
 * and Claude, told by the mod what the tag means, resolves the item once it
 * has acted on it (sending does not resolve it here).
 *
 * Over the controls, never in the thread: the list's position belongs to
 * `useThreadScroll` alone.
 */
export function HeadsUpChatBar({
  items,
  onAnswer,
  onMore,
}: {
  items: readonly HeadsUpItem[];
  onAnswer: (item: HeadsUpItem) => void;
  onMore: () => void;
}) {
  const { colors } = useTheme();
  if (items.length === 0) return null;
  const shown = items.slice(0, size.headsUpChatItems);
  const more = items.length - shown.length;
  return (
    <Glass testID="headsup-chat-bar" style={{ borderRadius: radius.lg, overflow: 'hidden', padding: spacing.md, gap: spacing.sm }}>
      {shown.map((item) => {
        const urgent = item.blocking;
        return (
          <View key={item.id} testID={`headsup-chat-item-${item.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text variant="footnote" color={urgent ? 'attention' : 'label'} style={{ flex: 1, minWidth: 0 }}>
              <Text variant="footnote" color={urgent ? 'attention' : 'secondary'} weight="600">{`${chatItemLabel(item)}: `}</Text>
              {item.text}
            </Text>
            <Pressable
              testID={`headsup-answer-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Answer: ${item.text}`}
              hitSlop={spacing.sm}
              onPress={() => {
                haptics.selection();
                onAnswer(item);
              }}
              style={({ pressed }) => ({
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
                borderRadius: radius.full,
                backgroundColor: pressed ? colors.fillSubtle : urgent ? colors.attentionMuted : colors.tintMuted,
              })}>
              <Text variant="footnote" color={urgent ? 'attention' : 'tint'} weight="600">Answer</Text>
            </Pressable>
          </View>
        );
      })}
      {more > 0 && (
        <Pressable
          testID="headsup-chat-more"
          accessibilityRole="button"
          hitSlop={spacing.sm}
          onPress={onMore}>
          <Text variant="footnote" color="tint">{`${more} more in Heads Up`}</Text>
        </Pressable>
      )}
    </Glass>
  );
}
