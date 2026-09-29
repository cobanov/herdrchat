import * as Clipboard from 'expo-clipboard';
import { memo, useCallback } from 'react';
import { Pressable, View } from 'react-native';

import { showActionSheet, type SheetAction } from './ActionSheet';
import { BubbleImage } from './BubbleImage';
import { Markdown } from './Markdown';
import { Text } from './Text';
import { haptics } from '@/lib/haptics';
import { copyOptions } from '@/lib/messageCopy';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, size, spacing } from '@/theme/tokens';
import type { ChatMessage, MessageSegment } from '@/lib/transcript/message';
import { displayText } from '@/lib/transcript/message';

/**
 * One message in the thread.
 *
 * Yours is a bubble: 18pt continuous corners, the tail only on the LAST bubble
 * of a run, which is what makes three messages read as one utterance.
 *
 * The agent's is not. Its prose runs the full width of the column on the page
 * itself, the way a document reads, because a reply is often long, carries
 * code, and is the thing the screen is for; a bubble around it only narrowed
 * it and framed it as chatter. Tool activity is not drawn here at all: the
 * thread folds it into runs (see `threadItems`).
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
  const visibleSegments = message.segments.filter((segment) => segment.kind === 'text' || segment.kind === 'image');
  const pictures = message.segments.filter((segment) => segment.kind === 'image').length;

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

  const a11y = {
    accessibilityRole: 'button' as const,
    accessibilityLabel: `${outgoing ? 'Your message' : 'Agent message'}. ${displayText(message)}${pictures > 0 ? `, ${pictures} ${pictures === 1 ? 'picture' : 'pictures'}` : ''}${timeLabel ? `, ${timeLabel}` : ''}`,
    accessibilityHint: 'Long press to copy',
    accessibilityActions: [{ name: 'longpress', label: 'Copy message' }],
    onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === 'longpress') copy();
    },
  };

  if (!outgoing) {
    return (
      <Pressable onLongPress={copy} delayLongPress={400} {...a11y} testID={`bubble-${message.id}`} style={{ gap: spacing.sm }}>
        {visibleSegments.map((segment, index) => (
          <Segment key={index} segment={segment} onTint={false} />
        ))}
      </Pressable>
    );
  }

  return (
    <View style={{ flexDirection: 'row' }}>
      <Gutter />
      <Pressable
        onLongPress={copy}
        // Never a tap handler. A bubble containing an expandable tool chip has
        // its own press targets inside it, and a tap on the bubble itself must
        // stay a tap on whatever it landed on.
        delayLongPress={400}
        {...a11y}
        testID={`bubble-${message.id}`}
        style={[
          {
            flexShrink: 1,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            backgroundColor: colors.bubbleOutgoing,
            gap: spacing.xs,
          },
          corners,
        ]}>
        {visibleSegments.map((segment, index) => (
          <Segment key={index} segment={segment} onTint />
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
  return <View style={{ flexGrow: 1, flexBasis: '18%', minWidth: size.bubbleGutterMin }} />;
}

function Segment({ segment, onTint }: { segment: MessageSegment; onTint: boolean }) {
  switch (segment.kind) {
    case 'text':
      return <Markdown text={segment.text} onTint={onTint} />;
    case 'image':
      return <BubbleImage path={segment.path} onTint={onTint} />;
    default:
      return null;
  }
}
