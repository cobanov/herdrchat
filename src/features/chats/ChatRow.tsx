import { memo } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, size, spacing, typography, useScaledLine } from '@/theme/tokens';
import type { ChatSummary } from './useWorkspaces';

/** Shared with the loading skeleton so content does not jump on arrival. */
export const AVATAR_SIZE = size.chatBadge;

/**
 * How the agents herdr detects are named on a row. Letta Code joined in herdr
 * 0.9.1 (#120); anything else shows herdr's own id.
 */
const AGENT_NAMES: Readonly<Record<string, string>> = { claude: 'Claude', codex: 'Codex', letta: 'Letta' };

/** Something a row can do besides open, named for assistive technology. */
export interface RowAction {
  name: string;
  label: string;
  run: () => void;
}

export const ChatRow = memo(function ChatRow({
  summary, unread, selected = false, onPress, onLongPress, actions = [],
}: {
  summary: ChatSummary;
  unread: boolean;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  /**
   * Offered to VoiceOver (the rotor's Actions) and Voice Control ("Show
   * actions"). A swipe is invisible to both, so without these a row's swipe
   * actions exist only for people who can see and drag (#112).
   */
  actions?: readonly RowAction[];
}) {
  const { colors, reduceMotion } = useTheme();
  const previewHeight = useScaledLine(typography.footnote.lineHeight);
  const attention = summary.status === 'blocked';
  const working = summary.status === 'working';
  const agent = summary.agents.find((item) => item.focused && item.agent !== null)
    ?? summary.agents.find((item) => item.agent !== null);
  const provider = agent?.agent == null ? 'Terminal' : (AGENT_NAMES[agent.agent] ?? agent.agent);
  const folder = agent?.cwd.split('/').filter(Boolean).slice(-2).join('/') ?? '';
  const context = [provider, folder].filter(Boolean).join(' · ');
  const status = attention ? 'Waiting for you' : working ? 'Working' : summary.status === 'unknown' ? 'Status unknown' : summary.status === 'done' ? 'Done' : 'Idle';
  const preview = summary.preview === null ? status
    : `${summary.preview.fromUser ? 'You: ' : ''}${summary.preview.text}`;
  // herdr's own sentence, which already says what to do about it.
  const restoreFailed = summary.restoreError !== null ? `Couldn't restore. ${summary.restoreError}` : null;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityActions={actions.map(({ name, label }) => ({ name, label }))}
      onAccessibilityAction={(event) => {
        actions.find((action) => action.name === event.nativeEvent.actionName)?.run();
      }}
      accessibilityLabel={[summary.title || summary.workspaceId, context, status, unread ? 'Unread' : '', restoreFailed ?? summary.preview?.text].filter(Boolean).join(', ')}
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
        {restoreFailed !== null ? (
          <Text variant="footnote" color="destructive" numberOfLines={2} testID="chat-row-restore-error">
            {restoreFailed}
          </Text>
        ) : (
          <Text variant="footnote" color={attention ? 'attention' : 'secondary'} numberOfLines={1} style={{ minHeight: previewHeight }}>
            {attention ? 'Waiting for your input' : preview}
          </Text>
        )}
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
