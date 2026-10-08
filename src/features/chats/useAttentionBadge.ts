import { useEffect, useMemo } from 'react';

import { type ThreadRead } from '@/lib/unread';
import { isChatUnread } from './chatUnread';
import { useBadge } from '@/state/badge';
import { summaryNeedsAttention, type ChatSummary } from './useWorkspaces';

/**
 * Publish the attention count for the tab bar's badge.
 *
 * Computed here because the number is already in hand — the alternative is a
 * second poll in the tab layout, which would double every host's SSH round-trips
 * to learn something this screen recalculated a moment ago.
 *
 * The write is an effect, not a render-phase call: publishing to a store outside
 * React's tree is a side effect, and doing it during render is the kind of thing
 * that works until concurrent rendering retries one.
 *
 * Counted by workspace: a workspace and the agents listed under it are one
 * thing needing you, not two or three. Its status already rolls its agents up,
 * and it is unread while any of them is.
 */
export function useAttentionBadge(
  summaries: readonly ChatSummary[],
  reads: Map<string, ThreadRead>,
  active: boolean,
  /** The chat on screen beside the list, by `chatKey`. */
  open: string | null = null
): void {
  const count = useMemo(
    () =>
      summaries.filter(
        (summary) =>
          summaryNeedsAttention(summary) ||
          isChatUnread(summary, reads, open)
      ).length,
    [summaries, reads, open]
  );

  useEffect(() => {
    useBadge.getState().setCount(active ? count : 0);
  }, [count, active]);
}
