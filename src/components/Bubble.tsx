import { memo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Markdown } from './Markdown';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { ChatMessage, MessageSegment } from '@/lib/transcript/message';

/**
 * A chat bubble: 18pt continuous corners, no shadow, system surfaces.
 *
 * Following the iMessage convention, only the LAST bubble of a run gets the
 * small tail corner; bubbles inside a run stay fully rounded. That is what makes
 * three consecutive messages read as one utterance instead of a stack of boxes.
 */
export const Bubble = memo(function Bubble({
  message,
  isLastInGroup = true,
  timeLabel,
}: {
  message: ChatMessage;
  isLastInGroup?: boolean;
  timeLabel?: string | null;
}) {
  const { colors } = useTheme();
  const outgoing = message.role === 'user';

  const corners = {
    borderTopLeftRadius: radius.bubble,
    borderTopRightRadius: radius.bubble,
    borderBottomLeftRadius: outgoing || !isLastInGroup ? radius.bubble : radius.tail,
    borderBottomRightRadius: outgoing && isLastInGroup ? radius.tail : radius.bubble,
  };

  return (
    <View style={{ flexDirection: 'row' }}>
      {outgoing && <Gutter />}
      <View
        style={[
          {
            flexShrink: 1,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm - 1,
            backgroundColor: outgoing ? colors.tint : colors.bubbleIncoming,
            gap: spacing.xs,
          },
          corners,
        ]}>
        {message.segments.map((segment, index) => (
          <Segment key={index} segment={segment} onTint={outgoing} />
        ))}
        {isLastInGroup && timeLabel !== null && timeLabel !== undefined && (
          // Trailing-aligned WITHOUT `flex: 1`. A greedy timestamp stretches
          // every last-in-group bubble to the full width cap, so a two-word
          // reply renders as a wide, mostly-empty box with the text stranded on
          // the left. A zero-width spacer keeps the bubble hugging its content.
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Text variant="caption2" color={outgoing ? 'onTint' : 'secondary'} style={{ opacity: 0.75 }}>
              {timeLabel}
            </Text>
          </View>
        )}
      </View>
      {!outgoing && <Gutter />}
    </View>
  );
});

/**
 * The empty channel opposite a bubble, which is what caps how wide a bubble can
 * grow. A share of the container rather than a fixed ceiling: a hard 300pt cap
 * leaves bubbles stranded in a sea of background on a large phone, and never
 * adapts to Dynamic Type.
 */
function Gutter() {
  return <View style={{ flexGrow: 1, flexBasis: '18%', minWidth: spacing.xxl + spacing.md }} />;
}

function Segment({ segment, onTint }: { segment: MessageSegment; onTint: boolean }) {
  switch (segment.kind) {
    case 'text':
      return <Markdown text={segment.text} onTint={onTint} />;
    case 'thinking':
      return <ToolChip glyph="…" label="thought" />;
    case 'toolUse':
      return (
        <ToolChip
          glyph="❯"
          label={segment.input !== null ? `${segment.name} ${segment.input}` : segment.name}
          accent
          expandable={segment.input !== null}
        />
      );
    case 'toolResult':
      return <ToolChip glyph="✓" label="tool result" />;
  }
}

/**
 * Tool activity as a terminal token: monospaced, quiet, unmistakably CLI.
 *
 * Deliberately undesigned — this is the agent's machinery, not its answer, and
 * dressing it up would compete with the message it sits inside. Tapping an
 * expandable chip reveals the full call in place, so a long command can be read
 * without leaving the thread.
 */
export function ToolChip({
  glyph,
  label,
  accent = false,
  expandable = false,
}: {
  glyph: string;
  label: string;
  accent?: boolean;
  expandable?: boolean;
}) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);

  return (
    <Pressable
      onPress={expandable ? () => setExpanded((value) => !value) : undefined}
      disabled={!expandable}
      accessibilityRole={expandable ? 'button' : undefined}
      accessibilityLabel={expandable ? `Tool call: ${label}` : label}
      accessibilityState={expandable ? { expanded } : undefined}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.xs + 1,
        alignSelf: 'flex-start',
        paddingHorizontal: spacing.sm - 1,
        paddingVertical: spacing.xxs + 1,
        borderRadius: radius.chip,
        backgroundColor: colors.fillSubtle,
      }}>
      <Text variant="caption2" mono weight="700" color={accent ? 'tint' : 'secondary'}>
        {glyph}
      </Text>
      <Text
        variant="caption2"
        mono
        color="secondary"
        numberOfLines={expandable && expanded ? undefined : 1}
        style={{ flexShrink: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}
