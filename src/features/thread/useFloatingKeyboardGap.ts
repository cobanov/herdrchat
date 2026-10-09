import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, Platform, type KeyboardEvent } from 'react-native';

import { floatingKeyboardGap } from '@/lib/composerInset';

/**
 * The gap between the bottom of the screen and a keyboard frame that floats
 * above it, such as the input-assistant bar an iPad shows with a hardware
 * keyboard; zero for a docked keyboard and whenever none is up.
 *
 * The keyboard controller gives the frame's height only, which is all a docked
 * keyboard needs. Where the frame sits comes from React Native's own events,
 * which carry its origin. iOS only: an Android IME always rests on the edge.
 */
export function useFloatingKeyboardGap(): number {
  const [gap, setGap] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const measure = (event: KeyboardEvent) => {
      setGap(floatingKeyboardGap(event.endCoordinates, Dimensions.get('screen').height));
    };
    const subscriptions = [
      Keyboard.addListener('keyboardWillShow', measure),
      // The bar collapsing to its pill, or expanding again, moves the frame
      // without a new show.
      Keyboard.addListener('keyboardWillChangeFrame', measure),
      Keyboard.addListener('keyboardWillHide', () => setGap(0)),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);
  return gap;
}
