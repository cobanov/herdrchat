/**
 * How far the thread's floating controls sit above the bottom of the
 * conversation area, given how much of the bottom the keyboard covers.
 *
 * The bottom safe-area inset exists to clear the home indicator. Whatever the
 * keyboard covers already clears it, so the controls keep only what is left of
 * the inset above the keyboard's top edge, and never less than `minimum`, the
 * breathing room between the pill and whatever is under it.
 *
 * A continuous function of the keyboard's height, not a keyboard-up flag, so
 * the controls follow the keyboard frame by frame, including while a finger
 * drags it down: a flag flipped only once the drag was over and the composer
 * jumped. It is the same rule for anything iOS reports as keyboard, a software
 * keyboard or the input-assistant bar an iPad shows with a hardware keyboard.
 *
 * A worklet, so the UI thread can call it on every keyboard frame; it is plain
 * arithmetic, and Jest calls it like any function.
 */
export function composerInset(keyboardHeight: number, safeBottom: number, minimum: number): number {
  'worklet';
  const uncovered = Math.max(safeBottom - Math.max(keyboardHeight, 0), 0);
  return Math.max(uncovered, minimum);
}

/**
 * How far above the bottom of the screen a keyboard frame's bottom edge sits:
 * zero for a docked keyboard, which rests on the edge, and the gap under the
 * frame for one that floats.
 *
 * react-native-keyboard-controller reports a keyboard by its frame's HEIGHT
 * (`keyboardFrameEndUserInfoKey.size.height`) and assumes it rests on the
 * bottom edge. The input-assistant bar an iPad shows with a hardware keyboard
 * (Writing Tools, dictation) can float some points above the home indicator,
 * and lifting the composer by the bar's height alone left it that many points
 * behind the bar. The thread adds this gap to the lift.
 *
 * `screenY` and `height` are the frame iOS posts, in screen coordinates, so
 * this measures against the screen rather than the window: a docked keyboard
 * reads zero in a split view or Stage Manager window too. A frame of no height
 * (a hidden or an undocked keyboard) has nothing under it to clear.
 */
export function floatingKeyboardGap(frame: { screenY: number; height: number }, screenHeight: number): number {
  if (frame.height <= 0) return 0;
  return Math.max(screenHeight - (frame.screenY + frame.height), 0);
}
