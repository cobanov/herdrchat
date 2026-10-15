import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';
import { radius, size } from '@/theme/tokens';

/**
 * The outermost element of every screen.
 *
 * It exists so that "what a page is made of" is decided once. Before it, the
 * root screens used `SafeAreaView` and presented ones used a bare `View`, which is a
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
   * `form-sheet` is a sheet sized to its content, which never reaches the
   * status bar on either platform.
   */
  presentation = 'full',
}: {
  children: ReactNode;
  presentation?: 'full' | 'sheet' | 'form-sheet' | 'edge-to-edge';
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

  // A sheet on Android is a full-screen page, not a card below the status bar,
  // so it clears the status bar like any other screen (#4 acceptance). A form
  // sheet is the exception: on Android it is a bottom sheet, and a status-bar
  // inset there was an empty band above its title.
  if (presentation === 'form-sheet') return <FormSheet>{content}</FormSheet>;
  if (presentation === 'edge-to-edge' || (presentation === 'sheet' && Platform.OS === 'ios')) {
    return <View style={{ flex: 1, backgroundColor: colors.systemBackground }}>{content}</View>;
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.systemBackground }} edges={['top', 'left', 'right']}>
      {content}
    </SafeAreaView>
  );
}

/**
 * Android's bottom sheet runs under the gesture bar, and rises for the keyboard
 * by that much less than the keyboard: without the inset, its last line sat
 * under one or the other.
 *
 * Its top corners follow the sheet's own (`sheetCornerRadius` in the root
 * layout); painted square, this page would cover the rounding.
 */
function FormSheet({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const android = Platform.OS === 'android';
  return (
    <View
      testID="form-sheet"
      style={{
        flex: 1,
        backgroundColor: colors.systemBackground,
        paddingBottom: android ? insets.bottom : 0,
        borderTopLeftRadius: android ? radius.lg : 0,
        borderTopRightRadius: android ? radius.lg : 0,
      }}>
      {children}
    </View>
  );
}
