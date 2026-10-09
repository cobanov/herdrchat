import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { titledBySession } from '@/lib/chatTitle';
import { agentName } from '@/lib/herdr/models';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, size, spacing, typography, useScaledLine } from '@/theme/tokens';
import { formatListTime } from './ChatRow';
import { rowTestKey, type MachineRef } from './listedChat';
import { paneContext, paneTitle, statusLabel } from './rowText';
import type { ChatSummary, PaneSummary } from './useWorkspaces';

/**
 * One agent of a workspace that runs several, listed under the workspace's row.
 *
 * A workspace with two agents used to be one row naming one of them, and the
 * other was reachable only as unattributed lines merged into the first one's
 * thread. Each now has a row of its own that opens a thread with just that
 * agent in it, while the workspace row above still opens them all together.
 *
 * Inset and hung off a rail so it reads as part of the workspace, not as a
 * chat of equal rank: pin, mute, rename and close belong to the workspace, so
 * there is no swipe here, and a long press offers the workspace's own sheet.
 */
export const PaneRow = memo(function PaneRow({
  summary, pane, unread, selected = false, first = false, last = false, onPress, onLongPress,
}: {
  /** With `machine`, a workspace on one of the host's machines, whose label leads the row's line. */
  summary: ChatSummary & { machine?: MachineRef | null };
  pane: PaneSummary;
  unread: boolean;
  selected?: boolean;
  /**
   * The first agent listed under its workspace: the rail reaches up across
   * the gap below the workspace's card, which would otherwise leave it
   * hanging off nothing.
   */
  first?: boolean;
  /** The last agent listed under its workspace: the rail stops at this row. */
  last?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { colors, reduceMotion } = useTheme();
  const previewHeight = useScaledLine(typography.footnote.lineHeight);
  const attention = pane.status === 'blocked';
  const working = pane.status === 'working';
  const provider = agentName(pane.agent.agent);
  const folder = pane.agent.cwd.split('/').filter(Boolean).slice(-2).join('/');
  const status = statusLabel(pane.status);
  const preview = pane.preview === null ? status : `${pane.preview.fromUser ? 'You: ' : ''}${pane.preview.text}`;
  const workspace = summary.title || summary.workspaceId;
  const machine = summary.machine?.label;
  const context = paneContext(summary, pane);
  // Only a title of the agent's own: falling back to the workspace label
  // repeated the card right above, on every untitled sibling alike.
  const title = titledBySession(pane) ? paneTitle(summary, pane) : null;

  return (
    <View style={{ flexDirection: 'row', paddingBottom: spacing.sm }}>
      {/* The rail: down from the workspace row, with a branch into this one.
          The first row's line starts a gap higher, where the card ends.
          Its height is the card's, so the branch meets the card's middle;
          the gap below the card carries the line on to the next agent. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: size.paneIndent }}>
        <View style={{ flex: 1 }}>
          <View style={{ position: 'absolute', left: size.paneIndent / 2, top: first ? -spacing.sm : 0, bottom: last ? '50%' : 0, width: StyleSheet.hairlineWidth, backgroundColor: colors.separator }} />
          <View style={{ position: 'absolute', left: size.paneIndent / 2, right: 0, top: '50%', height: StyleSheet.hairlineWidth, backgroundColor: colors.separator }} />
        </View>
        <View style={{ height: spacing.sm }}>
          {!last && <View style={{ position: 'absolute', left: size.paneIndent / 2, top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: colors.separator }} />}
        </View>
      </View>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        // The title first, when the agent has one.
        accessibilityLabel={[title ?? '', `${provider} in ${workspace}${machine === undefined ? '' : ` on ${machine}`}`, folder, status, unread ? 'Unread' : '', pane.preview?.text].filter(Boolean).join(', ')}
        testID={`pane-row-${rowTestKey(summary, pane.paneId)}`}
        style={({ pressed }) => ({
          flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
          marginLeft: size.paneIndent, paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
          borderRadius: radius.sm, borderWidth: 1,
          borderColor: attention ? colors.attentionBorder : selected ? colors.tint : 'transparent',
          backgroundColor: pressed ? colors.chatCardPressed : colors.chatCard,
        })}>
        {selected && (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius.sm, backgroundColor: colors.tintMuted }]} />
        )}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ width: size.paneBadge, height: size.paneBadge, borderRadius: radius.xs, backgroundColor: colors.tintMuted, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={pane.agent.agent === 'claude' ? 'asterisk' : 'chevron.left.forwardslash.chevron.right'} size={size.paneBadgeGlyph} tintColor={colors.tint} />
        </View>

        <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
          {/* The session's title, as the workspace chat's row has. The card
              above already names the workspace, so neither line here does: an
              agent with no title of its own leads with its provider, after
              its machine when it is on one. */}
          {title !== null && <Text variant="subhead" weight="600" numberOfLines={2}>{title}</Text>}
          <Text variant="caption" color="secondary" mono numberOfLines={1}>{context}</Text>
          <Text variant="footnote" color={attention ? 'attention' : 'secondary'} numberOfLines={1} style={{ minHeight: previewHeight }}>
            {attention ? 'Waiting for your input' : preview}
          </Text>
        </View>

        <View style={{ alignItems: 'center', gap: spacing.xs }}>
          {working && !reduceMotion ? <ActivityIndicator size="small" color={colors.tint} /> : (
            <Icon
              name={attention ? 'exclamationmark.circle' : working ? 'ellipsis.circle' : unread ? 'circle.fill' : 'circle'}
              size={size.rowStatusGlyph}
              tintColor={attention ? colors.attention : unread || working ? colors.tint : colors.secondaryLabel}
            />
          )}
          {working ? <Text variant="caption2" color="tint">now</Text> : pane.preview?.timestamp != null && (
            <Text variant="caption2" color="secondary">{formatListTime(pane.preview.timestamp)}</Text>
          )}
        </View>
      </Pressable>
    </View>
  );
});
