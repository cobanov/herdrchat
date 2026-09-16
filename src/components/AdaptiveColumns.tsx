import type { ReactNode } from 'react';
import { Platform, useWindowDimensions, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { size } from '@/theme/tokens';

export function useTabletLayout(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'ios' && Platform.isPad && width >= size.tabletBreakpoint;
}

/** Keep the detail mounted when an iPad window narrows or rotates. */
export function AdaptiveColumns({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const wide = useTabletLayout();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.systemBackground }}>
      {wide && (
        <View key="sidebar" testID="tablet-sidebar" style={{ width: size.tabletSidebarWidth, borderRightWidth: 1, borderRightColor: colors.separator }}>
          {sidebar}
        </View>
      )}
      <View key="detail" testID="detail-pane" style={{ flex: 1, minWidth: 0 }}>
        {children}
      </View>
    </View>
  );
}
