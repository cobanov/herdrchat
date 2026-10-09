import { Pressable, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { openWorkflow, useDelegationScope } from '@/features/thread/delegation';
import { DelegationCard, StateGlyph, figures, useReportState } from '@/features/thread/SubagentCard';
import { runState, useWorkflowRun } from '@/features/thread/useWorkflowRun';
import { formatDuration, formatTokens, formatToolCalls } from '@/lib/subagents/format';
import type { WorkflowAgent, WorkflowPhase, WorkflowRun } from '@/lib/subagents/workflowRun';
import type { Delegation, ToolCall } from '@/lib/threadItems';
import { modelDisplayName } from '@/lib/transcript/sessionMeta';
import { useToolRuns } from '@/state/toolRuns';
import { useTheme } from '@/theme/ThemeProvider';
import { size, spacing } from '@/theme/tokens';

/**
 * A workflow the agent started: many subagents under phases. Its name and
 * what it is for, where it stands, and, opened, each phase with its agents.
 * The chevron opens the run.
 *
 * Until its run file is read the card says what the call said: the script's
 * name and description, and the transcript's state. Once read, the file's
 * own status wins: it is what Claude writes as the run goes, where the
 * transcript only learns of the end when a notification arrives.
 */
export function WorkflowCard({
  call,
  delegation,
  runId,
  name,
  description,
}: {
  call: ToolCall;
  delegation: Delegation;
  runId: string | null;
  name: string;
  description: string | null;
}) {
  const scope = useDelegationScope();
  const opened = useToolRuns((store) => store.open[call.key] ?? false);
  const entry = useWorkflowRun(scope?.client ?? null, scope?.connectionId ?? '', scope?.sessionDirs ?? [], runId, {
    // A running run is followed on the card; a finished one is read only to be opened.
    active: delegation.state === 'running' || opened,
    awaitFile: delegation.state === 'running',
  });
  const run = entry?.run ?? null;
  const state = runState(run, delegation.state);
  const title = run?.name ?? name;
  const id = call.id ?? call.key;

  useReportState(call.id, state);

  const onOpen = scope === null || scope.sessionDirs.length === 0 || runId === null
    ? null
    : () => openWorkflow(scope, runId, title);

  return (
    <DelegationCard
      testID={`workflow-${id}`}
      openTestID={`workflow-open-${id}`}
      foldKey={call.key}
      glyph="square.stack.3d.up"
      kindLabel="Workflow"
      title={title}
      detail={run?.summary ?? description}
      caption={[progress(run), ...runFigures(run, delegation)].filter((part) => part !== null).join(' · ')}
      state={state}
      result={state === 'running' ? null : delegation.result}
      onOpen={onOpen}
      openLabel="Open this workflow's run"
      body={run === null || run.phases.length === 0 ? null : <WorkflowPhases phases={run.phases} />}
    />
  );
}

/** "2 of 3 agents done", once the run says how many it has. */
function progress(run: WorkflowRun | null): string | null {
  if (run === null) return null;
  const agents = run.phases.flatMap((phase) => phase.agents);
  if (agents.length === 0) return null;
  const done = agents.filter((agent) => agent.state === 'done').length;
  if (done === agents.length) return `${agents.length} ${agents.length === 1 ? 'agent' : 'agents'}`;
  return `${done} of ${agents.length} agents done`;
}

/** The run's own totals when it has them, else what the notification said. */
function runFigures(run: WorkflowRun | null, delegation: Delegation): string[] {
  if (run === null || (run.durationMs === null && run.totalTokens === null)) return figures(delegation);
  return [formatDuration(run.durationMs ?? delegation.durationMs), formatTokens(run.totalTokens)]
    .filter((part): part is string => part !== null);
}

/** A run's phases, each with its agents, under the card's header. */
function WorkflowPhases({ phases }: { phases: readonly WorkflowPhase[] }) {
  return (
    <View style={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, gap: spacing.sm }}>
      {phases.map((phase, index) => (
        <View key={`${index}:${phase.title}`} style={{ gap: spacing.xxs }}>
          <Text variant="caption" weight="600" color="secondary">
            {phase.title}
          </Text>
          {phase.agents.map((agent) => (
            <WorkflowAgentRow key={`${agent.index}:${agent.label}`} agent={agent} />
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * One agent of a run: its label, its model, where it stands and for how
 * long. `detailed` adds what it is doing or handed back, and its tokens and
 * tool calls, for the run's own screen; `onOpen` makes the row open its
 * transcript there.
 */
export function WorkflowAgentRow({
  agent,
  detailed = false,
  onOpen,
}: {
  agent: WorkflowAgent;
  detailed?: boolean;
  onOpen?: () => void;
}) {
  const { colors } = useTheme();
  const caption = [
    modelDisplayName(agent.model),
    formatDuration(agent.durationMs),
    ...(detailed ? [formatTokens(agent.tokens), formatToolCalls(agent.toolCalls)] : []),
  ].filter((part): part is string => part !== null).join(' · ');
  const doing = !detailed ? null : agent.state === 'failed'
    ? agent.error ?? agent.lastTool
    : agent.state === 'running' ? agent.lastTool : agent.resultPreview;

  return (
    <Pressable
      testID={`workflow-agent-${agent.label}`}
      onPress={onOpen}
      disabled={onOpen === undefined}
      accessibilityRole={onOpen === undefined ? undefined : 'button'}
      accessibilityLabel={`${agent.label}, ${agent.state}${caption.length > 0 ? `, ${caption}` : ''}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: detailed ? size.workflowAgentRow : size.toolRow,
      }}>
      <StateGlyph state={agent.state} />
      <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
          <Text variant="footnote" weight="600" mono numberOfLines={1} style={{ flexShrink: 1 }}>
            {agent.label}
          </Text>
          {caption.length > 0 && (
            <Text variant="caption" color="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
              {caption}
            </Text>
          )}
        </View>
        {doing !== null && (
          <Text variant="caption" color={agent.state === 'failed' ? 'destructive' : 'secondary'} numberOfLines={2}>
            {doing}
          </Text>
        )}
      </View>
      {onOpen !== undefined && (
        <Icon name="chevron.right" size={size.rowChevron} tintColor={colors.tertiaryLabel} fallback={<Text color="tertiary">›</Text>} />
      )}
    </Pressable>
  );
}
