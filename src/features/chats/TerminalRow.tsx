import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { TERMINAL_ROW_TITLE, type TerminalPane } from '@/lib/terminal/rows';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, size, spacing } from '@/theme/tokens';
import { rowTestKey, type MachineRef } from './listedChat';
import { terminalContext } from './rowText';
import type { ChatSummary } from './useWorkspaces';

/**
 * A pane of a workspace that is not a chat (a shell, a build, `vim`, an agent
 * the app cannot talk to), listed under its workspace's card. It opens the
 * pane's terminal.
 *
 * Hung off the same rail as the agents' rows, after them, so it reads as part
 * of the workspace. No status, unread mark or preview: a terminal has no
 * conversation to summarise, and no pin, mute or rename either in this round.
 */
export const TerminalRow = memo(function TerminalRow({ summary, terminal, first = false, last = false, onPress }: {
  summary: ChatSummary & { machine?: MachineRef | null };
  terminal: TerminalPane;
  /** The first row under the workspace's card: the rail reaches up to the card. */
  first?: boolean;
  /** The last row under the card: the rail stops here. */
  last?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const context = terminalContext(terminal.pane, terminal.processName);
  const workspace = summary.title || summary.workspaceId;
  const machine = summary.machine?.label;

  return (
    <View style={{ flexDirection: 'row', paddingBottom: spacing.sm }}>
      {/* The rail, as an agent's row under the same card draws it. */}
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
        accessibilityRole="button"
        accessibilityLabel={[`${TERMINAL_ROW_TITLE} in ${workspace}${machine === undefined ? '' : ` on ${machine}`}`, context].join(', ')}
        accessibilityHint="Opens the pane's terminal"
        testID={`terminal-row-${rowTestKey(summary, terminal.paneId)}`}
        style={({ pressed }) => ({
          flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
          marginLeft: size.paneIndent, paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
          borderRadius: radius.sm,
          backgroundColor: pressed ? colors.chatCardPressed : colors.chatCard,
        })}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ width: size.paneBadge, height: size.paneBadge, borderRadius: radius.xs, backgroundColor: colors.fillSubtle, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="terminal" size={size.paneBadgeGlyph} tintColor={colors.secondaryLabel} fallback={<Text variant="caption" mono>{'>_'}</Text>} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
          <Text variant="subhead" weight="600" numberOfLines={1}>{TERMINAL_ROW_TITLE}</Text>
          <Text variant="caption" color="secondary" mono numberOfLines={1}>{context}</Text>
        </View>
        <Icon name="chevron.right" size={size.rowChevron} tintColor={colors.tertiaryLabel} fallback={<Text color="tertiary">›</Text>} />
      </Pressable>
    </View>
  );
});
