import { useEffect, useMemo } from 'react';

import { isThreadUnread, type ThreadRead } from '@/lib/unread';
import { useBadge } from '@/state/badge';
import { summaryNeedsAttention, type ChatSummary } from './useWorkspaces';

/**
 * Publish the attention count (see `src/state/badge.ts`; nothing reads it since
 * the tab bar and its badge went away).
 *
 * Computed here because the number is already in hand — the alternative is a
 * second poll wherever it is shown, which would double every host's SSH
 * round-trips to learn something this screen recalculated a moment ago.
 *
 * The write is an effect, not a render-phase call: publishing to a store outside
 * React's tree is a side effect, and doing it during render is the kind of thing
 * that works until concurrent rendering retries one.
 */
export function useAttentionBadge(
  summaries: readonly ChatSummary[],
  reads: Map<string, ThreadRead>,
  active: boolean
): void {
  const count = useMemo(
    () =>
      summaries.filter(
        (summary) =>
          summaryNeedsAttention(summary) ||
          isThreadUnread(summary.preview, summary.sessionSig, reads.get(summary.workspaceId))
      ).length,
    [summaries, reads]
  );

  useEffect(() => {
    useBadge.getState().setCount(active ? count : 0);
  }, [count, active]);
}
