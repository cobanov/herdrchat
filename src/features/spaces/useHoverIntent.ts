import { useEffect, useRef } from 'react';

/**
 * A pointer's comings and goings (`HoverView`), held back: `onIn` after the
 * pointer has rested `delayIn`, `onOut` after it has been gone `delayOut`, and
 * neither when it came back, or left, in the meantime. So a pointer crossing
 * the list does not flash a card at every button it passes, and one moving
 * from a button to its card does not drop the card on the way.
 *
 * The timers live in a ref and are cleared on unmount; nothing is set in an
 * effect.
 */
export function useHoverIntent({ onIn, onOut, delayIn = 0, delayOut = 0 }: {
  onIn?: () => void;
  onOut?: () => void;
  delayIn?: number;
  delayOut?: number;
}): (over: boolean) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** What was last handed on: an out with no in before it says nothing. */
  const delivered = useRef(false);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  return (over: boolean) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (over === delivered.current) return;
    const run = () => {
      timer.current = null;
      delivered.current = over;
      (over ? onIn : onOut)?.();
    };
    const delay = over ? delayIn : delayOut;
    if (delay <= 0) run();
    else timer.current = setTimeout(run, delay);
  };
}
