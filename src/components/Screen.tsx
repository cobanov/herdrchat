import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';
import { size } from '@/theme/tokens';

/**
 * The outermost element of every screen.
 *
 * It exists so that "what a page is made of" is decided once. Before it, tab
 * screens used `SafeAreaView` and presented ones used a bare `View`, which is a
 * real difference — the safe-area inset shifted the header down on some pages
 * and not others — expressed as an accident rather than a decision.
 *
 * Sheets already start below the status bar. Edge-to-edge conversations put
 * material behind it and inset only their controls. Other screens keep the
 * shared safe-area and readable-width defaults.
 */
export function Screen({
  children,
  /**
   * `sheet` for anything presented modally, `full` for a screen that owns the
   * whole window and must clear the status bar itself. `edge-to-edge` lets a
   * scrolling surface reach behind system chrome; its controls own the insets.
   */
  presentation = 'full',
}: {
  children: ReactNode;
  presentation?: 'full' | 'sheet' | 'edge-to-edge';
}) {
  const { colors } = useTheme();
  // Let Yoga adapt to rotation and window resizing without device detection.
  const content = (
    <View
      testID="screen-content"
      style={{ flex: 1, width: '100%', maxWidth: presentation === 'edge-to-edge' ? undefined : size.contentMaxWidth, alignSelf: 'center' }}>
      {children}
    </View>
  );

  if (presentation !== 'full') {
    return <View style={{ flex: 1, backgroundColor: colors.systemBackground }}>{content}</View>;
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.systemBackground }} edges={['top', 'left', 'right']}>
      {content}
    </SafeAreaView>
  );
}
