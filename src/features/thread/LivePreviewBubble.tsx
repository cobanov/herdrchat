import { View } from 'react-native';

import { Text } from '@/components/Text';
import { TypingDots } from '@/components/Activity';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, size, spacing } from '@/theme/tokens';

/**
 * A dim bubble showing the answer the agent is currently writing, scraped from
 * the pane's visible screen.
 *
 * Marked "live" and visually quieter than a real bubble on purpose: this is a
 * best-effort read of a terminal, not a transcript turn, and it is superseded by
 * the real bubble once the turn settles. Making it look identical would turn
 * every scraping mistake into an apparent statement by the agent.
 */
export function LivePreviewBubble({ text }: { text: string }) {
  const { colors } = useTheme();

  return (
    <View style={{ flexDirection: 'row' }}>
      <View
        style={{
          flexShrink: 1,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderTopLeftRadius: radius.bubbleTail,
          borderTopRightRadius: radius.md,
          borderBottomLeftRadius: radius.md,
          borderBottomRightRadius: radius.md,
          backgroundColor: colors.bubbleIncoming,
          opacity: 0.75,
          gap: spacing.sm,
        }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <TypingDots size={4} />
          <Text variant="caption2" color="tint" weight="600">
            live
          </Text>
        </View>
        <Text variant="callout" color="secondary">
          {text}
        </Text>
      </View>
      <View style={{ flexGrow: 1, flexBasis: '18%', minWidth: size.bubbleGutterMin }} />
    </View>
  );
}
