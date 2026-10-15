import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { useSpaceLayoutSheet } from '@/state/spaceLayout';
import { applyPaneOpen } from './openPane';

/**
 * Opens the pane a box in the phone's layout sheet asked for, on the chats
 * root's next focus. The sheet only records the pane and closes
 * (`useSpaceLayoutSheet`); opening it from here means the push is a separate
 * commit from the pop, made by the root, rather than the same batch as the
 * sheet's `router.back()`.
 *
 * Focus is JS state, not a native event: expo-router emits it from an effect
 * as soon as the state after the pop commits, so the native formSheet may
 * still be animating its dismissal when the push starts. If a device ever
 * shows the push fighting that animation, wait for the native stack's
 * `transitionEnd` on the root instead. Taken once: a later focus opens nothing.
 */
export function usePendingPaneOpen(): void {
  useFocusEffect(
    useCallback(() => {
      const open = useSpaceLayoutSheet.getState().take();
      if (open !== null) applyPaneOpen(open);
    }, [])
  );
}
