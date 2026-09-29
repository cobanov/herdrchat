import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import { toolCallLine, toolRunSummary, type ToolCall, type ToolKind } from '@/lib/threadItems';
import { useSettings } from '@/state/settings';
import { useToolRuns } from '@/state/toolRuns';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, size, spacing, typography, useScaledLine } from '@/theme/tokens';

/**
 * A run of tool activity, folded into one quiet line:
 * "Ran 3 commands · edited 1 file · 1 failed".
 *
 * The agent's machinery, not its answer, so it reads as a margin note between
 * paragraphs rather than as content. Opened, each call hangs off a rail with
 * what it did in a line; a call opens in turn to show what it returned.
 *
 * Closed by default; the header's tool switch opens every run at once.
 */
export function ToolRun({ runKey, calls, thoughts }: { runKey: string; calls: readonly ToolCall[]; thoughts: number }) {
  const { colors } = useTheme();
  const expandAll = useSettings((state) => state.showToolActivity);
  const stored = useToolRuns((state) => state.open[runKey]);
  const toggle = useToolRuns((state) => state.toggle);
  const open = stored ?? expandAll;
  const summary = toolRunSummary(calls, thoughts);
  const failed = calls.some((call) => call.failed);

  return (
    <View testID="tool-run">
      <Pressable
        onPress={() => {
          haptics.selection();
          toggle(runKey, open);
        }}
        disabled={calls.length === 0}
        accessibilityRole="button"
        accessibilityLabel={summary}
        accessibilityState={{ expanded: open }}
        hitSlop={spacing.sm}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: size.toolSummaryHeight }}>
        <View style={{ width: size.toolRail, alignItems: 'center', transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
          <Icon name="chevron.right" size={size.toolGlyph} tintColor={colors.tertiaryLabel} fallback={<Text color="tertiary">›</Text>} />
        </View>
        <Text variant="footnote" color="secondary" style={{ flexShrink: 1 }} numberOfLines={1}>
          {summary}
        </Text>
        {failed && !open && (
          <View style={{ width: size.statusDot, height: size.statusDot, borderRadius: radius.full, backgroundColor: colors.destructive }} />
        )}
      </Pressable>

      {open && (
        <View style={{ paddingLeft: size.toolRail / 2 }}>
          {calls.map((call, index) => (
            <CallRow key={call.key} call={call} last={index === calls.length - 1} />
          ))}
        </View>
      )}
    </View>
  );
}

function CallRow({ call, last }: { call: ToolCall; last: boolean }) {
  const { colors } = useTheme();
  const opened = useToolRuns((state) => state.open[call.key] ?? false);
  const toggle = useToolRuns((state) => state.toggle);
  const line = toolCallLine(call);
  const firstLine = useScaledLine(typography.footnote.lineHeight);
  const branch = (size.toolRow - firstLine) / 2 + firstLine / 2;
  const ink = call.failed ? 'destructive' : 'secondary';
  const expandable = call.result !== null && call.result.trim().length > 0;

  return (
    <View style={{ flexDirection: 'row' }}>
      {/* The rail: a line down to the next call, and a curved branch into this one. */}
      <View style={{ width: size.toolRail }}>
        {!last && (
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: colors.separator }} />
        )}
        <View
          style={{
            width: size.toolRail,
            height: branch,
            borderLeftWidth: StyleSheet.hairlineWidth,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomLeftRadius: radius.xs,
            borderColor: colors.separator,
          }}
        />
      </View>
      <View style={{ flex: 1, paddingLeft: spacing.sm }}>
        <Pressable
          onPress={expandable ? () => toggle(call.key, opened) : undefined}
          disabled={!expandable}
          accessibilityRole={expandable ? 'button' : undefined}
          accessibilityLabel={`${line.verb} ${line.detail}${call.failed ? ', failed' : ''}`}
          accessibilityState={expandable ? { expanded: opened } : undefined}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: size.toolRow }}>
          <Icon name={GLYPHS[call.kind]} size={size.toolGlyph} tintColor={call.failed ? colors.destructive : colors.tertiaryLabel} fallback={<Text color="tertiary">•</Text>} />
          <Text variant="footnote" weight="600" color={ink}>
            {line.verb}
          </Text>
          <Text variant="footnote" mono color={ink} numberOfLines={opened ? undefined : 1} style={{ flex: 1 }}>
            {line.detail}
          </Text>
        </Pressable>
        {opened && call.result !== null && (
          <View
            style={{
              marginBottom: spacing.sm,
              padding: spacing.sm,
              borderRadius: radius.xs,
              backgroundColor: colors.fillSubtle,
            }}>
            <Text variant="caption2" mono color={ink} numberOfLines={size.toolOutputLines} selectable>
              {call.result.trim()}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const GLYPHS: Record<ToolKind, IconName> = {
  command: 'terminal',
  edit: 'pencil',
  read: 'doc.text',
  search: 'magnifyingglass',
  fetch: 'globe',
  todo: 'checklist',
  agent: 'cpu',
  tool: 'puzzlepiece.extension',
};

/**
 * A subagent the agent handed work to: a small card of its own rather than
 * one more line in a run, because it is a second worker, not a step.
 */
export function SubagentCard({ call }: { call: ToolCall }) {
  const { colors } = useTheme();
  const line = toolCallLine(call);
  return (
    <View
      testID="subagent-card"
      accessibilityLabel={`Agent: ${line.detail}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.sm,
        borderRadius: radius.sm,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.separator,
        backgroundColor: colors.secondarySystemBackground,
      }}>
      <View
        style={{
          width: size.agentTile,
          height: size.agentTile,
          borderRadius: radius.xs,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.fillSubtle,
        }}>
        <Icon name="cpu" size={size.toolGlyph} tintColor={colors.secondaryLabel} fallback={<Text color="secondary">◇</Text>} />
      </View>
      <Text variant="subhead" weight="600">
        Agent
      </Text>
      <Text variant="subhead" color="secondary" numberOfLines={1} style={{ flex: 1 }}>
        {line.detail}
      </Text>
      {call.failed && <Text variant="footnote" color="destructive">failed</Text>}
    </View>
  );
}
