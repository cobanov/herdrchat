import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { size, spacing } from '@/theme/tokens';
import { rowTestKey, type MachineRef } from './listedChat';
import type { ChatSummary } from './useWorkspaces';

/** Where the rows' text starts, past the rail, the row's padding and its badge. */
const TEXT_INSET = size.paneIndent + spacing.md + size.paneBadge + spacing.md;

/**
 * Where a tab's rows start under a space card that lists rows from two or
 * more tabs: a hairline from the tab before (not above the first), then the
 * tab's label when the person named it. Quieter than the rows, so the card
 * still reads as one workspace: the rail runs on through it, unbroken.
 */
export const TabDivider = memo(function TabDivider({ summary, tabId, label, first }: {
  summary: ChatSummary & { machine?: MachineRef | null };
  tabId: string;
  /** The tab's name, null for one herdr only numbered: a line and no label. */
  label: string | null;
  /** The card's first tab: its label and no line. */
  first: boolean;
}) {
  const { colors } = useTheme();
  const key = rowTestKey(summary, tabId);
  return (
    <View style={{ paddingBottom: spacing.sm }}>
      {/* The card's rail, on through: from the card itself above the first tab. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: first ? -spacing.sm : 0, bottom: 0, left: size.paneIndent / 2, width: StyleSheet.hairlineWidth, backgroundColor: colors.separator }} />
      {!first && (
        <View testID={`tab-divider-${key}`} style={{ marginLeft: TEXT_INSET, marginRight: spacing.md, height: StyleSheet.hairlineWidth, backgroundColor: colors.separator }} />
      )}
      {label !== null && (
        <Text
          testID={`tab-header-${key}`}
          accessibilityRole="header"
          variant="caption2"
          mono
          color="secondary"
          numberOfLines={1}
          style={{ marginLeft: TEXT_INSET, marginRight: spacing.md, paddingTop: first ? 0 : spacing.sm }}>
          {label}
        </Text>
      )}
    </View>
  );
});
