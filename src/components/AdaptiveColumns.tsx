import type { ReactNode } from 'react';
import { Platform, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { isFoldableModel, sidebarWidth, type SplitSizes } from '@/lib/splitView';
import { useTheme } from '@/theme/ThemeProvider';
import { size } from '@/theme/tokens';
import { deviceModelId } from '../../modules/herdr-device/src';

const splitSizes: SplitSizes = {
  breakpoint: size.splitBreakpoint,
  sidebar: size.splitSidebarWidth,
  compactSidebar: size.splitSidebarCompactWidth,
  fullSidebarFrom: size.splitSidebarFullFrom,
};

/**
 * An iPad, or an iPhone that unfolds: a chat or a terminal opens as the
 * detail of the chats screen, never as a pushed screen, at any width. That is
 * what lets an iPhone Duo fold and unfold under an open chat without losing it.
 */
export function isSplitDevice(): boolean {
  return Platform.OS === 'ios' && (Platform.isPad || isFoldableModel(deviceModelId()));
}

/** The sidebar's width when the chats stand beside the detail, or null for one column. */
export function useSplitSidebar(): number | null {
  const { width } = useWindowDimensions();
  return isSplitDevice() ? sidebarWidth(width, splitSizes) : null;
}

export function useSplitLayout(): boolean {
  return useSplitSidebar() !== null;
}

/**
 * Keep the detail mounted when an iPad window narrows or rotates, or a Duo folds.
 *
 * Each column is its own safe-area provider. A `SafeAreaView` and
 * `useSafeAreaInsets` read the nearest provider's insets, and the window's
 * are wrong for a column: an iPhone Duo's strip on the right edge (status bar,
 * tab bar) left a gap of its width beside the chats on the left, while the
 * detail beside the strip is the column that has to clear it. A provider
 * measures its own view, so each column gets the insets of the edges it meets.
 */
export function AdaptiveColumns({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const width = useSplitSidebar();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.systemBackground }}>
      {width !== null && (
        <View key="sidebar" testID="tablet-sidebar" style={{ width, borderRightWidth: 1, borderRightColor: colors.separator }}>
          <SafeAreaProvider testID="sidebar-safe-area">{sidebar}</SafeAreaProvider>
        </View>
      )}
      <View key="detail" testID="detail-pane" style={{ flex: 1, minWidth: 0 }}>
        <SafeAreaProvider testID="detail-safe-area">{children}</SafeAreaProvider>
      </View>
    </View>
  );
}
