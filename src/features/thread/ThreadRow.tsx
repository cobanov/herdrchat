import { Bubble } from '@/components/Bubble';
import { Text } from '@/components/Text';
import { CommandNote } from '@/features/thread/CommandNote';
import { SubagentCard } from '@/features/thread/SubagentCard';
import { ToolRun } from '@/features/thread/ToolRun';
import { WorkflowCard } from '@/features/thread/WorkflowCard';
import type { PlacedItem } from '@/lib/threadItems';
import { spacing } from '@/theme/tokens';

/**
 * One placed item of a transcript, drawn: a bubble, a folded tool run, a
 * command's note, a subagent's or a workflow's card. The main thread and a
 * subagent's read-only thread draw their rows with this, so a subagent's own
 * subagents are cards there exactly as they are here.
 *
 * Only the item. The row's spacing, the older-history label and a failed
 * send's retry belong to the list around it.
 */
export function ThreadRow({ placed }: { placed: PlacedItem }) {
  const { item } = placed;
  return (
    <>
      {item.kind === 'agent' && placed.startsTurn && item.message.agentLabel !== null && (
        <Text variant="caption2" color="secondary" style={{ paddingBottom: spacing.xxs }}>
          {item.message.agentLabel}
        </Text>
      )}
      {item.kind === 'tools' ? (
        <ToolRun runKey={item.runKey} calls={item.calls} thoughts={item.thoughts.length} />
      ) : item.kind === 'subagent' ? (
        <SubagentCard call={item.call} delegation={item.delegation} />
      ) : item.kind === 'workflow' ? (
        <WorkflowCard
          call={item.call}
          delegation={item.delegation}
          runId={item.runId}
          name={item.name}
          description={item.description}
        />
      ) : item.kind === 'note' ? (
        <CommandNote message={item.message} />
      ) : (
        <Bubble
          message={item.message}
          isLastInGroup={placed.endsGroup}
          timeLabel={item.kind === 'user' && placed.endsGroup ? formatTime(item.message.timestamp) : null}
        />
      )}
    </>
  );
}

function formatTime(timestamp: number | null): string | null {
  if (timestamp === null) return null;
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
