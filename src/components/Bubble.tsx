import * as Clipboard from 'expo-clipboard';
import { memo, useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';

import { showActionSheet, type SheetAction } from './ActionSheet';
import { Markdown } from './Markdown';
import { Text } from './Text';
import { haptics } from '@/lib/haptics';
import { copyOptions } from '@/lib/messageCopy';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { ChatMessage, MessageSegment } from '@/lib/transcript/message';
import { useSettings } from '@/state/settings';

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
  const showToolActivity = useSettings((state) => state.showToolActivity);
  const outgoing = message.role === 'user';

  // With tool activity off, a turn that was ONLY machinery would render as an
  // empty bubble — so the thread filters those out entirely (see buildRows) and
  // this only has to drop the chips from mixed turns.
  const visibleSegments = showToolActivity
    ? message.segments
    : message.segments.filter((segment) => segment.kind === 'text');

  const corners = {
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderBottomLeftRadius: outgoing || !isLastInGroup ? radius.md : radius.bubbleTail,
    borderBottomRightRadius: outgoing && isLastInGroup ? radius.bubbleTail : radius.md,
  };

  /**
   * Long press to copy.
   *
   * The entire output of this app is text an agent wrote — a command, a path, a
   * diff, an explanation — and until now there was no way to get any of it off
   * the phone. Chat rows had a long press; the bubbles, which are the reason the
   * app exists, did not.
   *
   * "Copy code" only appears when there is code. Most answers are prose wrapped
   * around the one line you actually wanted, and picking that out by hand on a
   * touchscreen is the thing this removes.
   */
  const copy = useCallback(() => {
    const options = copyOptions(message);
    if (options.full.trim().length === 0) return;

    haptics.medium();
    const actions: SheetAction[] = [
      {
        label: 'Copy message',
        onPress: () => {
          void Clipboard.setStringAsync(options.full);
          haptics.success();
        },
      },
    ];
    if (options.code !== null) {
      // Above "Copy message" would put the narrower action first; below keeps
      // the general case where the thumb lands by default.
      actions.push({
        label: 'Copy code only',
        onPress: () => {
          void Clipboard.setStringAsync(options.code ?? '');
          haptics.success();
        },
      });
    }
    showActionSheet({ title: outgoing ? 'Your message' : 'Agent message', actions });
  }, [message, outgoing]);

  return (
    <View style={{ flexDirection: 'row' }}>
      {outgoing && <Gutter />}
      <Pressable
        onLongPress={copy}
        // Never a tap handler. A bubble containing an expandable tool chip has
        // its own press targets inside it, and a tap on the bubble itself must
        // stay a tap on whatever it landed on.
        delayLongPress={400}
        accessibilityRole="button"
        accessibilityLabel={outgoing ? 'Your message' : 'Agent message'}
        accessibilityHint="Long press to copy"
        testID={`bubble-${message.id}`}
        style={[
          {
            flexShrink: 1,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm - 1,
            backgroundColor: outgoing ? colors.bubbleOutgoing : colors.bubbleIncoming,
            gap: spacing.xs,
          },
          corners,
        ]}>
        {visibleSegments.map((segment, index) => (
          <Segment key={index} segment={segment} onTint={outgoing} />
        ))}
        {isLastInGroup && timeLabel !== null && timeLabel !== undefined && (
          // Trailing-aligned WITHOUT `flex: 1`. A greedy timestamp stretches
          // every last-in-group bubble to the full width cap, so a two-word
          // reply renders as a wide, mostly-empty box with the text stranded on
          // the left. A zero-width spacer keeps the bubble hugging its content.
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            {/* No opacity on the outgoing side: white at 0.75 over the fill
                measured 2.94:1 in light and 2.43:1 in dark. The incoming label
                sits on a near-background surface and can afford the fade. */}
            <Text
              variant="caption2"
              color={outgoing ? 'onTint' : 'secondary'}
              style={outgoing ? undefined : { opacity: 0.75 }}>
              {timeLabel}
            </Text>
          </View>
        )}
      </Pressable>
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
        borderRadius: radius.xs,
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
