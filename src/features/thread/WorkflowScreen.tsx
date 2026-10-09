import { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { openSubagent, useClientFor, workflowAgentKey } from '@/features/thread/delegation';
import { runState, useWorkflowRun } from '@/features/thread/useWorkflowRun';
import { ReadOnlyHeader } from '@/features/thread/ReadOnlyHeader';
import { WorkflowAgentRow } from '@/features/thread/WorkflowCard';
import { formatDuration, formatTokens } from '@/lib/subagents/format';
import type { WorkflowAgent } from '@/lib/subagents/workflowRun';
import { modelDisplayName } from '@/lib/transcript/sessionMeta';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, size, spacing, threadLayout } from '@/theme/tokens';

/**
 * A workflow run: its phases and each agent in them (what it is doing or
 * handed back, its model, how long, how much), and the lines the script
 * logged. Read from the run's file, again every few seconds while the run is
 * going. An agent opens its own transcript.
 */
export default function WorkflowScreen({
  connectionId,
  workspaceId,
  dirs,
  runId,
  title,
  onBack,
}: {
  connectionId: string;
  workspaceId: string;
  dirs: readonly string[];
  runId: string;
  title: string;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const client = useClientFor(connectionId);
  const [headerHeight, setHeaderHeight] = useState<number>(insets.top + threadLayout.initialHeaderHeight);
  const entry = useWorkflowRun(client, connectionId, dirs, runId, { active: true, awaitFile: true });
  const run = entry?.run ?? null;
  const state = run === null ? null : runState(run, 'running');
  const subtitle = [
    run?.status ?? null,
    formatDuration(run?.durationMs ?? null),
    formatTokens(run?.totalTokens ?? null),
  ].filter((part): part is string => part !== null).join(' · ');

  // The agents' transcripts are in the folder the run was found in.
  const dir = entry?.dir ?? null;
  const open = (agent: WorkflowAgent) => {
    if (dir === null || agent.agentId === null) return undefined;
    const agentId = agent.agentId;
    return () => openSubagent(
      { client, connectionId, workspaceId, sessionDirs: [dir] },
      { kind: 'agent', agentId, runId },
      {
        title: agent.label,
        subtitle: [modelDisplayName(agent.model), run?.name ?? title].filter((part): part is string => part !== null).join(' · '),
        followKey: workflowAgentKey(runId, agentId),
        state: agent.state,
      }
    );
  };

  return (
    <Screen presentation="edge-to-edge">
      {run === null ? (
        <View style={{ flex: 1, paddingTop: headerHeight, justifyContent: 'center' }}>
          {entry?.absent === true ? (
            <EmptyState symbol="square.stack.3d.up" title="Starting" body="This run hasn't written its progress yet. It shows here as soon as it does." />
          ) : (
            <ActivityIndicator color={colors.secondaryLabel} />
          )}
        </View>
      ) : (
        <ScrollView
          testID="workflow-screen"
          scrollIndicatorInsets={{ top: headerHeight }}
          contentContainerStyle={{
            width: '100%',
            maxWidth: size.contentMaxWidth,
            alignSelf: 'center',
            paddingTop: headerHeight + spacing.sm,
            paddingBottom: insets.bottom + spacing.xl,
            paddingHorizontal: screenPadding,
            gap: spacing.xl,
          }}>
          {run.summary !== null && (
            <Text variant="subhead" color="secondary">
              {run.summary}
            </Text>
          )}
          {run.phases.map((phase, index) => (
            <View key={`${index}:${phase.title}`} testID={`workflow-phase-${phase.title}`} style={{ gap: spacing.xs }}>
              <Text variant="headline">{phase.title}</Text>
              {phase.detail !== null && (
                <Text variant="footnote" color="secondary">
                  {phase.detail}
                </Text>
              )}
              <View style={{ gap: spacing.xs, paddingTop: spacing.xs }}>
                {phase.agents.length === 0 ? (
                  <Text variant="footnote" color="tertiary">
                    No agents yet
                  </Text>
                ) : phase.agents.map((agent) => (
                  <WorkflowAgentRow key={`${agent.index}:${agent.label}`} agent={agent} detailed onOpen={open(agent)} />
                ))}
              </View>
            </View>
          ))}
          {run.logs.length > 0 && (
            <View style={{ gap: spacing.xs }}>
              <Text variant="headline">Log</Text>
              <View style={{ padding: spacing.sm, borderRadius: radius.xs, backgroundColor: colors.fillSubtle, gap: spacing.xxs }}>
                {run.logs.map((line, index) => (
                  <Text key={index} variant="caption2" mono color="secondary" selectable>
                    {line}
                  </Text>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      )}
      <ReadOnlyHeader
        testID="workflow"
        title={run?.name ?? title}
        subtitle={subtitle}
        state={state}
        backLabel="Back"
        onBack={onBack}
        onHeight={setHeaderHeight}
        error={entry?.error ?? null}
      />
    </Screen>
  );
}
