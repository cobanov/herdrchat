import { memo, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { PresenceAvatar } from '@/components/PresenceAvatar';
import { Text } from '@/components/Text';
import { TypingDots } from '@/components/Activity';
import { useTheme } from '@/theme/ThemeProvider';
import { screenPadding, spacing } from '@/theme/tokens';
import type { ChatSummary } from './useWorkspaces';

const AVATAR_SIZE = 52;
/** The avatar's ring adds 4pt on each side. */
const AVATAR_BOX = AVATAR_SIZE + 8;
const GAP = spacing.md;

/**
 * Where a row's TEXT begins, measured from the screen edge.
 *
 * Exported so the list separator can start at exactly the same x. A separator
 * that stops short of, or overshoots, the text it divides is the kind of
 * misalignment nobody can name but everybody sees.
 */
export const CHAT_ROW_TEXT_INSET = screenPadding + AVATAR_BOX + GAP;

/**
 * One workspace row, Messages anatomy: a presence-ring avatar, then title plus
 * time on the first line and the last message beneath.
 *
 * Live agent activity OVERRIDES the preview line — "working…" or "waiting for
 * you" — because when an agent is mid-task, what it last said matters less than
 * what it is doing.
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

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel(summary, unread)}
      testID={`chat-row-${summary.workspaceId}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: GAP,
        paddingHorizontal: screenPadding,
        paddingVertical: spacing.sm + 2,
        backgroundColor: pressed ? colors.fillSubtle : 'transparent',
      })}>
      <View>
        <PresenceAvatar
          colorKey={summary.title.length > 0 ? summary.title : summary.workspaceId}
          status={summary.status}
          size={AVATAR_SIZE}
        />
        {/* A badge on the avatar rather than a separate leading column. The old
            column reserved space on every row for a dot almost none of them
            have, which pushed all the content right and left a ragged gutter. */}
        {(attention || unread) && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: 14,
              height: 14,
              borderRadius: 7,
              borderWidth: 2,
              borderColor: colors.systemBackground,
              backgroundColor: attention ? colors.attention : colors.tint,
            }}
          />
        )}
      </View>

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
 * visibly changes height, and nudges every row under it, each time an agent
 * begins working.
 */
function Subtitle({ summary }: { summary: ChatSummary }) {
  const { colors } = useTheme();

  return (
    <Reserved>
      {summary.status === 'working' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {/* "working", not "typing": an agent isn't composing at a keyboard,
              it's running tools and thinking. The messaging word oversold it. */}
          <Text variant="subhead" color="tint">
            working…
          </Text>
          <TypingDots color={colors.tint} size={4.5} />
        </View>
      ) : summary.status === 'blocked' ? (
        <Text variant="subhead" color="attention">
          waiting for you
        </Text>
      ) : (
        <Text variant="subhead" color="secondary" numberOfLines={2}>
          {previewLine(summary)}
        </Text>
      )}
    </Reserved>
  );
}

/**
 * Reserves two subhead lines and centres its child vertically inside them.
 *
 * A column wrapper specifically: the previous version put `justifyContent:
 * 'center'` on the row that holds "working…" and its dots, where it centres
 * HORIZONTALLY — which shoved the live state into the middle of the row while
 * every other variant stayed left. Separating the two axes makes that
 * impossible.
 *
 * The reservation matters because these variants swap live as agents start and
 * stop working; without it a row changes height, and nudges every row under it,
 * each time an agent begins.
 */
function Reserved({ children }: { children: ReactNode }) {
  return (
    <View style={{ minHeight: 38, justifyContent: 'center', alignItems: 'flex-start' }}>
      {children}
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
