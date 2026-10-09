import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, size, spacing, typography, useScaledLine } from '@/theme/tokens';
import { rowTestKey, type MachineRef } from './listedChat';
import { rowContext, rowTitle, statusLabel } from './rowText';
import type { ChatSummary } from './useWorkspaces';

/** Shared with the loading skeleton so content does not jump on arrival. */
export const AVATAR_SIZE = size.chatBadge;

/** Something a row can do besides open, named for assistive technology. */
export interface RowAction {
  name: string;
  label: string;
  run: () => void;
}

export const ChatRow = memo(function ChatRow({
  summary, unread, selected = false, pinned = false, muted = false, onPress, onLongPress, actions = [],
}: {
  /** With `machine`, a chat on one of the host's machines: its label leads the line under the title. */
  summary: ChatSummary & { machine?: MachineRef | null };
  unread: boolean;
  selected?: boolean;
  pinned?: boolean;
  /** Notifications for this chat are off on this phone. */
  muted?: boolean;
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
  const title = rowTitle(summary);
  const context = rowContext(summary);
  const status = statusLabel(summary.status);
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
      accessibilityLabel={[title, pinned ? 'Pinned' : '', muted ? 'Muted' : '', context, status, unread ? 'Unread' : '', restoreFailed ?? summary.preview?.text].filter(Boolean).join(', ')}
      // `chat-row-w2` on the host, `chat-row-<machineId>-w1` on a machine
      // (`rowTestKey`): workspace ids repeat across machines, and a
      // connection id's slash has no place in a testID.
      testID={`chat-row-${rowTestKey(summary)}`}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        padding: spacing.md, borderRadius: radius.sm, borderWidth: 1,
        borderColor: attention ? colors.attentionBorder : selected ? colors.tint : 'transparent',
        backgroundColor: pressed ? colors.chatCardPressed : colors.chatCard,
      })}>
      {/* The selection tint laid over an opaque card rather than replacing it:
          alone it is translucent, and the swipe actions behind showed through. */}
      {selected && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius.sm, backgroundColor: colors.tintMuted }]} />
      )}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: radius.sm, backgroundColor: colors.tintMuted, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={agent?.agent === 'claude' ? 'asterisk' : 'chevron.left.forwardslash.chevron.right'} size={22} tintColor={colors.tint} />
      </View>

      <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <Text variant="headline" numberOfLines={2} style={{ flexShrink: 1 }}>{title}</Text>
          {pinned && <Icon name="pin.fill" size={size.rowBadgeGlyph} tintColor={colors.secondaryLabel} />}
          {muted && <Icon name="bell.slash.fill" size={size.rowBadgeGlyph} tintColor={colors.secondaryLabel} />}
        </View>
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
            size={size.rowStatusGlyph}
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
