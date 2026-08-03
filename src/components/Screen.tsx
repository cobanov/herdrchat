import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';

/**
 * The outermost element of every screen.
 *
 * It exists so that "what a page is made of" is decided once. Before it, tab
 * screens used `SafeAreaView` and presented ones used a bare `View`, which is a
 * real difference — the safe-area inset shifted the header down on some pages
 * and not others — expressed as an accident rather than a decision.
 *
 * A presented sheet already starts below the status bar, so it takes no top
 * inset; that is the only thing that legitimately varies, and it is now a prop
 * with one obvious value per context.
 */
export function Screen({
  children,
  /**
   * `sheet` for anything presented modally, `full` for a screen that owns the
   * whole window and must clear the status bar itself.
   */
  presentation = 'full',
}: {
  children: ReactNode;
  presentation?: 'full' | 'sheet';
}) {
  const { colors } = useTheme();

  if (presentation === 'sheet') {
    return <View style={{ flex: 1, backgroundColor: colors.systemBackground }}>{children}</View>;
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.systemBackground }} edges={['top']}>
      {children}
    </SafeAreaView>
  );
}
