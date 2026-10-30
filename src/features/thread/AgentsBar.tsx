import { ActivityIndicator, Pressable, View } from 'react-native';

import { Glass } from '@/components/Glass';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { subagentOpener } from '@/features/thread/SubagentCard';
import { useClock } from '@/features/thread/useClock';
import type { DelegationScope } from '@/features/thread/delegation';
import { haptics } from '@/components/haptics';
import { agentKindLabel, agentsMark, agentsSummary, liveElapsed, matchingDelegation } from '@/lib/subagents/agentsBar';
import { formatDuration, formatTokens } from '@/lib/subagents/format';
import type { PlacedItem } from '@/lib/threadItems';
import type { AgentRow, AgentRowState, AgentsPane } from '@/lib/transcript/agentsPane';
import { agentsBarKey, useAgentsBar } from '@/state/agentsBar';
import { useTheme } from '@/theme/ThemeProvider';
import { agentsBar, minTouchTarget, radius, size, spacing } from '@/theme/tokens';

/**
 * Claude Code's background agents, above the composer: the agents pane its
 * terminal draws under the prompt, read off the same screen as the live
 * preview and drawn here instead of being scraped into it as text.
 *
 * Folded, one line: how many work and the longest any has run. Open, a row
 * each with its kind, its task, how long it has run and what it has spent,
 * and how many more the terminal has below its fold. A row whose task is a
 * subagent card's description opens that agent's transcript, as the card's
 * chevron does. The times tick between polls, from when the screen was read.
 *
 * Open or folded is kept per chat for the session (`useAgentsBar`).
 */
export function AgentsBar({
  pane,
  readAt,
  items,
  scope,
  connectionId,
  chat,
}: {
  pane: AgentsPane;
  readAt: number;
  /** The thread's rows, where a row's subagent card is looked for. */
  items: readonly PlacedItem[];
  scope: DelegationScope | null;
  connectionId: string;
  chat: string;
}) {
  const { colors, reduceMotion } = useTheme();
  const key = agentsBarKey(connectionId, chat);
  const open = useAgentsBar((store) => store.open[key] === true);
  const toggle = useAgentsBar((store) => store.toggle);
  const now = useClock(agentsBar.tick);
  const summary = agentsSummary(pane, readAt, now);
  const mark = agentsMark(pane);

  return (
    <Glass testID="agents-bar" style={{ borderRadius: radius.lg, overflow: 'hidden', paddingHorizontal: spacing.md }}>
      <Pressable
        testID="agents-bar-toggle"
        onPress={() => {
          haptics.selection();
          toggle(key);
        }}
        accessibilityRole="button"
        accessibilityLabel={summary}
        accessibilityHint={open ? 'Hides the agents' : 'Shows each agent'}
        accessibilityState={{ expanded: open }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: minTouchTarget }}>
        <View testID={`agents-bar-mark-${mark}`} style={{ width: size.delegationGlyph, alignItems: 'center' }}>
          {mark === 'running' ? (
            reduceMotion ? <RunningDot /> : <ActivityIndicator size="small" color={colors.tint} />
          ) : mark === 'unknown' ? (
            <RunningDot color={colors.tertiaryLabel} />
          ) : (
            <StateMark state={mark} />
          )}
        </View>
        <Text testID="agents-bar-summary" variant="footnote" weight="600" style={{ flex: 1 }} numberOfLines={1}>
          {summary}
        </Text>
        <Icon
          name={open ? 'chevron.down' : 'chevron.up'}
          size={size.rowChevron}
          tintColor={colors.tertiaryLabel}
          fallback={<Text color="tertiary">{open ? '⌄' : '⌃'}</Text>}
        />
      </Pressable>
      {open && (
        <View testID="agents-bar-rows" style={{ paddingBottom: spacing.sm }}>
          {pane.rows.map((row, index) => (
            <AgentsBarRow
              // The pane's own order is its identity; a row has no id of its own.
              key={`${index}-${row.kind}-${row.task}`}
              index={index}
              row={row}
              elapsedMs={liveElapsed(row, readAt, now)}
              onOpen={openerFor(row, items, scope)}
            />
          ))}
          {pane.hidden > 0 && (
            <Text testID="agents-bar-more" variant="caption" color="secondary" style={{ paddingTop: spacing.xs }}>
              {pane.hidden} more in the terminal
            </Text>
          )}
        </View>
      )}
    </Glass>
  );
}

function openerFor(row: AgentRow, items: readonly PlacedItem[], scope: DelegationScope | null): (() => void) | null {
  const match = matchingDelegation(items, row.task);
  return match === null ? null : subagentOpener(scope, match.call, match.delegation);
}

/**
 * One agent: its state, its kind, its task on one line, its time and tokens.
 * One accessible element whose label says all of it, which is also what the
 * UI flows read; a row that opens a transcript is a button with a chevron.
 */
function AgentsBarRow({
  index,
  row,
  elapsedMs,
  onOpen,
}: {
  index: number;
  row: AgentRow;
  elapsedMs: number;
  onOpen: (() => void) | null;
}) {
  const { colors } = useTheme();
  const kind = agentKindLabel(row.kind);
  const figures = [formatDuration(elapsedMs), formatTokens(row.tokens)].filter((part): part is string => part !== null);
  const label = [`${kind}: ${row.task}`, row.state, ...figures].join(', ');
  const content = (
    <>
      <View style={{ width: size.delegationGlyph, alignItems: 'center' }}>
        <StateMark state={row.state} />
      </View>
      <Text variant="caption" color="secondary" weight="600" numberOfLines={1} style={{ width: agentsBar.kindWidth }}>
        {kind}
      </Text>
      <Text variant="footnote" numberOfLines={1} style={{ flex: 1 }}>
        {row.task}
      </Text>
      <Text variant="caption" color="secondary" numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
        {figures.join(' · ')}
      </Text>
      {onOpen !== null && (
        <Icon name="chevron.right" size={size.rowChevron} tintColor={colors.tertiaryLabel} fallback={<Text color="tertiary">›</Text>} />
      )}
    </>
  );
  const style = { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: minTouchTarget } as const;
  if (onOpen === null) {
    return (
      <View testID={`agents-row-${index}`} accessible accessibilityLabel={label} style={style}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={`agents-row-${index}`}
      onPress={() => {
        haptics.light();
        onOpen();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens this agent's transcript"
      style={({ pressed }) => [style, { borderRadius: radius.xs, backgroundColor: pressed ? colors.fillSubtle : 'transparent' }]}>
      {content}
    </Pressable>
  );
}

/** Running: a dot in the tint. Done: a tick. Failed: a cross in the attention colour. */
function StateMark({ state }: { state: AgentRowState }) {
  const { colors } = useTheme();
  if (state === 'running') return <RunningDot />;
  const failed = state === 'failed';
  return (
    <Icon
      name={failed ? 'xmark' : 'checkmark'}
      size={size.toolGlyph}
      tintColor={failed ? colors.attention : colors.positive}
      fallback={<Text variant="caption" color={failed ? 'attention' : 'secondary'}>{failed ? '✕' : '✓'}</Text>}
    />
  );
}

/** A dot in the tint; dimmed, the folded bar's mark when it cannot tell whether agents still run. */
function RunningDot({ color }: { color?: string }) {
  const { colors } = useTheme();
  return <View style={{ width: agentsBar.dot, height: agentsBar.dot, borderRadius: radius.full, backgroundColor: color ?? colors.tint }} />;
}
