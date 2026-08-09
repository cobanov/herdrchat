import { useNavigation } from 'expo-router';
import { useEffect } from 'react';

import { haptics } from '@/lib/haptics';

/**
 * A tap on the tab bar, felt.
 *
 * The obvious place for this would be an `onTabChange` prop on `<NativeTabs>`,
 * but that prop is internal — it exists on `NativeTabsViewProps`, not on the
 * public `NativeTabsProps`. What is public is React Navigation's `tabPress`
 * event, which the native tabs navigator emits on its `isNativeAction` branch
 * before dispatching the jump.
 *
 * Called from each tab screen rather than from `Screen`, which modal screens
 * also use — a haptic when a sheet appears would be wrong, and a prop to
 * suppress it would be a worse version of just calling this in three places.
 *
 * `selection`, per the calibration in `lib/haptics`: this is a picker, not a
 * confirmation. It also fires when you tap the tab you are already on, which is
 * correct — the tap did something (scroll to top, pop to root), and the bar
 * gives no other feedback that it registered.
 */
export function useTabPressHaptic(): void {
  const navigation = useNavigation();

  useEffect(() => {
    // Typed loosely on purpose: `tabPress` is emitted by the tabs navigator, and
    // `useNavigation` here resolves to the generic navigation prop, which does
    // not know about events its parent adds.
    const unsubscribe = (
      navigation as unknown as {
        addListener: (event: string, callback: () => void) => () => void;
      }
    ).addListener('tabPress', () => haptics.selection());
    return unsubscribe;
  }, [navigation]);
}
