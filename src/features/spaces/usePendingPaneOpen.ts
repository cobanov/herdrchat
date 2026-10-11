import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { useSpaceLayoutSheet } from '@/state/spaceLayout';
import { applyPaneOpen } from './openPane';

/**
 * Opens the pane a box in the phone's layout sheet asked for, on the chats
 * root, once the sheet has gone and the root has focus again. The sheet only
 * records the pane and closes (`useSpaceLayoutSheet`); opening it from here
 * means the push starts from the root, after the sheet has left the stack,
 * rather than racing its dismissal. Taken once: a later focus opens nothing.
 */
export function usePendingPaneOpen(): void {
  useFocusEffect(
    useCallback(() => {
      const open = useSpaceLayoutSheet.getState().take();
      if (open !== null) applyPaneOpen(open);
    }, [])
  );
}
