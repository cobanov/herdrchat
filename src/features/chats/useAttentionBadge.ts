import { useEffect, useMemo } from 'react';

import { chatWantsYou } from './chatUnread';
import { openFor, readsOf, type ListedChat, type OpenChat, type ReadsByConnection } from './listedChat';
import { useBadge } from '@/state/badge';

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
 *
 * Counted by workspace: a workspace and the agents listed under it are one
 * thing needing you, not two or three. What is open beside the list is left
 * out by `chatWantsYou`, down to the one agent when only that one is open.
 * A chat on one of the host's machines counts like the host's own, against
 * its own connection's reads.
 */
export function useAttentionBadge(
  summaries: readonly ListedChat[],
  reads: ReadsByConnection,
  active: boolean,
  /** The chat on screen beside the list. */
  open: OpenChat | null = null
): void {
  const count = useMemo(
    () =>
      summaries.filter((summary) => chatWantsYou(summary, readsOf(reads, summary), openFor(open, summary))).length,
    [summaries, reads, open]
  );

  useEffect(() => {
    useBadge.getState().setCount(active ? count : 0);
  }, [count, active]);
}
