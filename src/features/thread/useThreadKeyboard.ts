import { KeyboardController, useKeyboardHandler, useKeyboardState } from 'react-native-keyboard-controller';
import { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { useFloatingKeyboardGap } from '@/features/thread/useFloatingKeyboardGap';
import { composerInset } from '@/lib/composerInset';
import { spacing } from '@/theme/tokens';

/**
 * Where the thread's floating controls sit as the keyboard comes and goes.
 *
 * The bottom safe-area inset exists to clear the home indicator. A raised
 * keyboard already covers it, so keeping the inset then would leave the
 * composer floating a thumb's width above the keys.
 *
 * This was a `keyboardUp` flag from React Native's `Keyboard` events, `will*`
 * on iOS so the change rode the keyboard's curve. Those events say nothing
 * while a finger drags the keyboard down (iOS posts only the end), so once
 * the list could dismiss it interactively the composer would have jumped by
 * the whole inset after the drag. The keyboard's height now comes frame by
 * frame from react-native-keyboard-controller, on the UI thread, and
 * `composerInset` turns it into the gap; see there for the rule.
 *
 * The controls keep their resting inset as layout (`restingInset`) and are
 * TRANSLATED down by what the keyboard takes of it (`followKeyboard`).
 * Animating their padding instead would re-measure them, and set the
 * controls' height, on every frame of the drag. `keyboardTakes` is the same
 * for the settled keyboard, for the list's clearance.
 */
export function useThreadKeyboard(safeBottom: number) {
  /*
    Seeded from the keyboard as it is now, not 0: the thread can open with a
    keyboard or an iPad's assistant bar already up (split view, focus left in
    another field), and the avoider and the footer read that state at once.
    Starting at 0 left the controls an inset higher than both until the next
    keyboard event.
  */
  const keyboardHeight = useSharedValue(KeyboardController.state().height);
  useKeyboardHandler(
    {
      onMove: (event) => {
        'worklet';
        keyboardHeight.set(event.height);
      },
      onInteractive: (event) => {
        'worklet';
        keyboardHeight.set(event.height);
      },
      onEnd: (event) => {
        'worklet';
        keyboardHeight.set(event.height);
      },
    },
    []
  );
  // Floating controls clear the home indicator. Without this the composer sits
  // on the very bottom edge, where it is genuinely hard to hit.
  const restingInset = composerInset(0, safeBottom, spacing.md);
  /*
    The keyboard controller measures a keyboard by its frame's height and
    assumes it rests on the bottom edge, so the avoider lifts the controls by
    that much. The input-assistant bar an iPad shows with a hardware keyboard
    can float above the edge, and the composer stayed that gap behind it. The
    gap comes from the frame's origin and is added to the lift; for any docked
    keyboard it is 0. Settled, not per frame: a hardware keyboard's bar has no
    drag to follow.
  */
  const floatingGap = useFloatingKeyboardGap();
  const followKeyboard = useAnimatedStyle(() => ({
    transform: [
      { translateY: restingInset - composerInset(keyboardHeight.get(), safeBottom, spacing.md) - floatingGap },
    ],
  }));
  // The list's clearance is layout, so it takes the settled keyboard only: a
  // footer that changed size every frame would move the rows under the reader.
  const settledKeyboard = useKeyboardState((state) => state.height);
  const keyboardTakes = restingInset - composerInset(settledKeyboard, safeBottom, spacing.md) - floatingGap;
  return { followKeyboard, restingInset, keyboardTakes };
}
