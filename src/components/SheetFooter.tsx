import { useEffect, useState, type ReactNode } from 'react';
import { Dimensions, Keyboard, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';
import { screenPadding, spacing } from '@/theme/tokens';

/**
 * The actions pinned to the foot of a form sheet (Save, Start), kept above
 * the keyboard.
 *
 * A KeyboardAvoidingView cannot do this in a modal sheet on iOS: it measures
 * its frame against the sheet and the keyboard against the screen, and the
 * two differ by the sheet's offset from the top, so the button stayed under
 * the keys. Measuring the footer in the window has the same offset (measured:
 * 62pt short on an iPhone 18 Pro). A phone's modal sheet ends at the bottom of
 * the screen, so the keyboard covers exactly its own height of it, and that is
 * the lift. Android resizes for the keyboard through the screen's own
 * avoider, so only iOS is handled here.
 */
export function SheetFooter({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [lift, setLift] = useState(0);

  useEffect(() => {
    // iPad form sheets are moved clear of the keyboard by the system.
    if (Platform.OS !== 'ios' || Platform.isPad) return;
    const changed = Keyboard.addListener('keyboardWillChangeFrame', (event) => {
      const { height } = Dimensions.get('screen');
      setLift(event.endCoordinates.screenY >= height ? 0 : event.endCoordinates.height);
    });
    return () => changed.remove();
  }, []);

  return (
    <View
      style={{
        paddingHorizontal: screenPadding,
        paddingTop: spacing.md,
        paddingBottom: lift > 0 ? lift + spacing.md : Math.max(insets.bottom, spacing.lg),
        gap: spacing.sm,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.separator,
        backgroundColor: colors.systemBackground,
      }}>
      {children}
    </View>
  );
}
