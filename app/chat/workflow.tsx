import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';

import { decodeDirs, type WorkflowRouteParams } from '@/features/thread/delegation';
import WorkflowScreen from '@/features/thread/WorkflowScreen';

/** A workflow run, pushed above the chat it was opened from, as a subagent's transcript is (see `chat/agent`). */
export default function WorkflowRoute() {
  const params = useLocalSearchParams<Partial<Record<keyof WorkflowRouteParams, string>>>();
  const router = useRouter();
  const dirs = useMemo(() => decodeDirs(params.dirs), [params.dirs]);
  return (
    <WorkflowScreen
      key={`${params.connectionId ?? ''}:${params.runId ?? ''}`}
      connectionId={params.connectionId ?? ''}
      workspaceId={params.workspaceId ?? ''}
      dirs={dirs}
      runId={params.runId ?? ''}
      title={params.title !== undefined && params.title !== '' ? params.title : 'Workflow'}
      followKey={params.followKey ?? ''}
      initialState={params.state === 'done' || params.state === 'failed' ? params.state : 'running'}
      onBack={() => router.back()}
    />
  );
}
