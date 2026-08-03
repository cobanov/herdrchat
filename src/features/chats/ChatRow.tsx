import { memo } from 'react';
import { Pressable, View } from 'react-native';

import { PresenceAvatar } from '@/components/PresenceAvatar';
import { Text } from '@/components/Text';
import { TypingDots } from '@/components/Activity';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import type { ChatSummary } from './useWorkspaces';

/**
 * One workspace row, Messages anatomy: a leading attention dot, a presence-ring
 * avatar, then title plus time on the first line and the last message beneath.
 *
 * Live agent activity OVERRIDES the preview line — "working…" or "waiting for
 * you" — because when an agent is mid-task, what it last said is less useful
 * than what it is doing.
 */
export const ChatRow = memo(function ChatRow({
  summary,
  unread,
  onPress,
}: {
  summary: ChatSummary;
  unread: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const attention = summary.status === 'blocked';
  const dotColor = attention ? colors.attention : unread ? colors.tint : 'transparent';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel(summary, unread)}
      testID={`chat-row-${summary.workspaceId}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm + 2,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        backgroundColor: pressed ? colors.fillSubtle : 'transparent',
      })}>
      <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: dotColor }} />

      <PresenceAvatar
        title={summary.title}
        colorKey={summary.title.length > 0 ? summary.title : summary.workspaceId}
        status={summary.status}
      />

      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
          <Text variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
            {summary.title.length > 0 ? summary.title : summary.workspaceId}
          </Text>
          <View style={{ flex: 1 }} />
          {summary.preview?.timestamp != null && (
            <Text variant="footnote" color="secondary">
              {formatListTime(summary.preview.timestamp)}
            </Text>
          )}
        </View>
        <Subtitle summary={summary} />
      </View>
    </Pressable>
  );
});

/**
 * Every variant reserves the SAME height — two subhead lines — because they swap
 * live as agents start and stop working. Without a fixed reservation a row
 * visibly changes height (and nudges every row under it) each time an agent
 * begins working.
 */
function Subtitle({ summary }: { summary: ChatSummary }) {
  const { colors } = useTheme();
  const twoLines = { minHeight: 40 } as const;

  if (summary.status === 'working') {
    return (
      <View style={[{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 }, twoLines]}>
        {/* "working", not "typing": an agent isn't composing at a keyboard, it's
            running tools and thinking. The messaging-app word oversold it. */}
        <Text variant="subhead" color="tint">
          working…
        </Text>
        <TypingDots color={colors.tint} size={4.5} />
      </View>
    );
  }

  if (summary.status === 'blocked') {
    return (
      <View style={twoLines}>
        <Text variant="subhead" color="attention">
          waiting for you
        </Text>
      </View>
    );
  }

  return (
    <View style={twoLines}>
      <Text variant="subhead" color="secondary" numberOfLines={2}>
        {previewLine(summary)}
      </Text>
    </View>
  );
}

function previewLine(summary: ChatSummary): string {
  if (summary.preview === null) {
    return summary.status === 'done' ? 'done' : summary.agents.length === 0 ? 'idle' : 'online';
  }
  return summary.preview.fromUser ? `You: ${summary.preview.text}` : summary.preview.text;
}

function accessibilityLabel(summary: ChatSummary, unread: boolean): string {
  const parts = [summary.title];
  if (summary.status === 'blocked') parts.push('waiting for you');
  else if (summary.status === 'working') parts.push('working');
  else if (unread) parts.push('unread');
  if (summary.preview !== null) parts.push(summary.preview.text);
  return parts.join(', ');
}

/**
 * Messages-style row timestamp: time today, "Yesterday", weekday inside a week,
 * date beyond that.
 */
export function formatListTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (days === 0) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (days === 1) return 'Yesterday';
  if (days < 7) return date.toLocaleDateString('en-US', { weekday: 'long' });
  return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
}
