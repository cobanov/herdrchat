import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';

import { decodeDirs, type AgentTarget, type SubagentRouteParams } from '@/features/thread/delegation';
import SubagentScreen from '@/features/thread/SubagentScreen';
import type { DelegationState } from '@/lib/threadItems';

/**
 * A subagent's transcript, pushed above the chat it was opened from: on a
 * phone over the thread, on iPad over the split, whose back control (and
 * swipe) returns to it. Unlike `chat/[workspaceId]` it never becomes the
 * split's selection: it belongs to the chat behind it, and replacing that
 * chat with it would lose the way back.
 */
export default function SubagentRoute() {
  const params = useLocalSearchParams<Partial<Record<keyof SubagentRouteParams, string>>>();
  const router = useRouter();
  const dirs = useMemo(() => decodeDirs(params.dirs), [params.dirs]);
  const parents = useMemo(() => decodeDirs(params.parents), [params.parents]);
  const target = useMemo<AgentTarget | null>(() => {
    if (params.toolUseId !== undefined && params.toolUseId !== '') return { kind: 'call', toolUseId: params.toolUseId };
    if (params.agentId !== undefined && params.agentId !== '') {
      return { kind: 'agent', agentId: params.agentId, runId: params.runId === undefined || params.runId === '' ? null : params.runId };
    }
    return null;
  }, [params.toolUseId, params.agentId, params.runId]);

  return (
    <SubagentScreen
      key={`${params.connectionId ?? ''}:${params.followKey ?? ''}`}
      connectionId={params.connectionId ?? ''}
      workspaceId={params.workspaceId ?? ''}
      dirs={dirs}
      parents={parents}
      callId={params.callId !== undefined && params.callId !== '' ? params.callId : null}
      target={target}
      title={params.title !== undefined && params.title !== '' ? params.title : 'Agent'}
      subtitle={params.subtitle ?? ''}
      followKey={params.followKey ?? ''}
      initialState={stateParam(params.state)}
      onBack={() => router.back()}
    />
  );
}

function stateParam(value: string | undefined): DelegationState {
  return value === 'done' || value === 'failed' ? value : 'running';
}
