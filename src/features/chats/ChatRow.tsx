import { memo } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, size, spacing, typography, useScaledLine } from '@/theme/tokens';
import type { ChatSummary } from './useWorkspaces';

/** Shared with the loading skeleton so content does not jump on arrival. */
export const AVATAR_SIZE = size.chatBadge;

export const ChatRow = memo(function ChatRow({
  summary, unread, selected = false, onPress, onLongPress,
}: {
  summary: ChatSummary;
  unread: boolean;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { colors, reduceMotion } = useTheme();
  const previewHeight = useScaledLine(typography.footnote.lineHeight);
  const attention = summary.status === 'blocked';
  const working = summary.status === 'working';
  const agent = summary.agents.find((item) => item.focused && item.agent !== null)
    ?? summary.agents.find((item) => item.agent !== null);
  const provider = agent?.agent === 'claude' ? 'Claude' : agent?.agent === 'codex' ? 'Codex' : agent?.agent ?? 'Terminal';
  const folder = agent?.cwd.split('/').filter(Boolean).slice(-2).join('/') ?? '';
  const context = [provider, folder].filter(Boolean).join(' · ');
  const status = attention ? 'Waiting for you' : working ? 'Working' : summary.status === 'unknown' ? 'Status unknown' : summary.status === 'done' ? 'Done' : 'Idle';
  const preview = summary.preview === null ? status
    : `${summary.preview.fromUser ? 'You: ' : ''}${summary.preview.text}`;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={[summary.title || summary.workspaceId, context, status, unread ? 'Unread' : '', summary.preview?.text].filter(Boolean).join(', ')}
      testID={`chat-row-${summary.workspaceId}`}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        padding: spacing.md, borderRadius: radius.sm, borderWidth: 1,
        borderColor: attention ? colors.attentionBorder : selected ? colors.tint : 'transparent',
        backgroundColor: selected ? colors.tintMuted : pressed ? colors.fillSubtle : colors.chatCard,
      })}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: radius.sm, backgroundColor: colors.tintMuted, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={agent?.agent === 'claude' ? 'asterisk' : 'chevron.left.forwardslash.chevron.right'} size={22} tintColor={colors.tint} />
      </View>

      <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
        <Text variant="headline" numberOfLines={2}>{summary.title || summary.workspaceId}</Text>
        <Text variant="caption" color="secondary" mono numberOfLines={1}>{context}</Text>
        <Text variant="footnote" color={attention ? 'attention' : 'secondary'} numberOfLines={1} style={{ minHeight: previewHeight }}>
          {attention ? 'Waiting for your input' : preview}
        </Text>
      </View>

      <View style={{ alignItems: 'center', gap: spacing.sm }}>
        {working && !reduceMotion ? <ActivityIndicator size="small" color={colors.tint} /> : (
          <Icon
            name={attention ? 'exclamationmark.circle' : working ? 'ellipsis.circle' : unread ? 'circle.fill' : 'circle'}
            size={18}
            tintColor={attention ? colors.attention : unread || working ? colors.tint : colors.secondaryLabel}
          />
        )}
        {working ? <Text variant="caption2" color="tint">now</Text> : summary.preview?.timestamp != null && (
          <Text variant="caption2" color="secondary">{formatListTime(summary.preview.timestamp)}</Text>
        )}
      </View>
    </Pressable>
  );
});

export function formatListTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (days === 1) return 'Yesterday';
  if (days < 7) return date.toLocaleDateString('en-US', { weekday: 'short' });
  return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
}
