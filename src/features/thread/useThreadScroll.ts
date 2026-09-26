import type { FlashListRef } from '@shopify/flash-list';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  AppState,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { scrollStep, type ScrollEvent, type ScrollMode } from '@/lib/threadScroll';
import { threadLayout } from '@/theme/tokens';

/**
 * How close to the end still counts as at it: enough slack to survive a
 * rubber-band and sub-pixel rounding, small enough that a scrolled-back reader
 * is never mistaken for one at the end.
 */
const BOTTOM_SLACK = threadLayout.bottomSlack;

type ScrollEventArgs = NativeSyntheticEvent<NativeScrollEvent>;

/**
 * The thread list's scroll position: the one owner of every decision to move
 * it. The rules are in `scrollStep`; this feeds it the list's events and
 * carries out what it decides.
 *
 * Only a scroll the reader is making counts as theirs: from the moment a finger
 * lands until the drag, or the momentum it started, comes to rest. Every other
 * scroll event (the list measuring a bubble, putting itself at the end, keeping
 * the visible rows in place) moves the list without meaning anything, and
 * reading those as the reader's choice once left a thread short of its last
 * lines with nothing bringing it back (#4 acceptance).
 *
 * `resetKey` is whatever re-keys the list. A new list starts at its end, so the
 * reader is following it again.
 */
export function useThreadScroll<T>(listRef: RefObject<FlashListRef<T> | null>, resetKey: number) {
  const mode = useRef<ScrollMode>('following');
  const readerMoving = useRef(false);
  const offset = useRef(0);
  const contentHeight = useRef(0);
  const viewportHeight = useRef(0);
  const [awayFromEnd, setAwayFromEnd] = useState(false);

  useEffect(() => {
    mode.current = 'following';
  }, [resetKey]);

  /**
   * The native scroll view, scrolled directly. FlashList's own `scrollToEnd`
   * finishes in a timer that dereferences its scroll view without a check, and
   * a list that unmounts in between (a reload remounts it by `key`) threw there:
   * Reload crashed the app every time on Android (#4 acceptance), and an
   * uncaught error is fatal in any release build.
   */
  const scrollToEnd = useCallback(
    (animated: boolean) => listRef.current?.getNativeScrollRef()?.scrollToEnd({ animated }),
    [listRef]
  );

  /** The jump button shows only for a reader who is away from the end. */
  const settle = useCallback(() => {
    const distance = contentHeight.current - offset.current - viewportHeight.current;
    setAwayFromEnd(mode.current === 'reading' && distance > BOTTOM_SLACK);
  }, []);

  const dispatch = useCallback(
    (event: ScrollEvent, animated = false) => {
      const step = scrollStep(mode.current, event, BOTTOM_SLACK);
      mode.current = step.mode;
      // Nothing moves the list under a reader's finger, but asking for the end
      // is theirs to ask for even mid-flick.
      if (event.kind === 'wantsEnd') readerMoving.current = false;
      if (step.toEnd && !readerMoving.current) scrollToEnd(animated);
      settle();
    },
    [scrollToEnd, settle]
  );

  const measure = (event: ScrollEventArgs) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    offset.current = contentOffset.y;
    contentHeight.current = contentSize.height;
    viewportHeight.current = layoutMeasurement.height;
    return contentSize.height - contentOffset.y - layoutMeasurement.height;
  };

  const readerScrolled = (event: ScrollEventArgs) => {
    dispatch({ kind: 'readerScrolled', distanceFromEnd: measure(event) });
  };

  useFocusEffect(
    useCallback(() => {
      dispatch({ kind: 'resumed' });
    }, [dispatch])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') dispatch({ kind: 'resumed' });
    });
    return () => subscription.remove();
  }, [dispatch]);

  return {
    /** Whether the jump-to-end button should show. */
    awayFromEnd,
    /** The reader asked for the end: sent a message, tapped the jump button, reloaded. */
    followEnd: (animated: boolean) => dispatch({ kind: 'wantsEnd' }, animated),
    /** Whether the list is scrolled to its very top. */
    atTop: () => offset.current <= 0,
    listProps: {
      onScroll: (event: ScrollEventArgs) => {
        if (readerMoving.current) {
          readerScrolled(event);
        } else {
          measure(event);
          settle();
        }
      },
      onScrollBeginDrag: () => {
        readerMoving.current = true;
      },
      // A drag let go without a flick ends here; one with a flick hands over to
      // its momentum, which begins right after.
      onScrollEndDrag: (event: ScrollEventArgs) => {
        readerScrolled(event);
        readerMoving.current = false;
      },
      onMomentumScrollBegin: () => {
        readerMoving.current = true;
      },
      onMomentumScrollEnd: (event: ScrollEventArgs) => {
        if (!readerMoving.current) return;
        readerScrolled(event);
        readerMoving.current = false;
      },
      onLayout: (event: LayoutChangeEvent) => {
        viewportHeight.current = event.nativeEvent.layout.height;
        dispatch({ kind: 'resized' });
      },
      onContentSizeChange: (_width: number, height: number) => {
        contentHeight.current = height;
        dispatch({ kind: 'resized' });
      },
    },
  };
}
