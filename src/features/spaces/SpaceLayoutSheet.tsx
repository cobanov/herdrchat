import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { spaceStats, spaceTitle } from '@/features/chats/rowText';
import { useSpaceLayoutSheet } from '@/state/spaceLayout';
import { minTouchTarget, screenPadding, spaceLayout, spacing } from '@/theme/tokens';
import type { PaneOpen } from './openPane';
import { SpaceLayout } from './SpaceLayout';

/**
 * A workspace's layout on a phone: a sheet sized to its tabs, opened from a
 * space card or its layout button. The workspace is the one the list handed
 * over (`useSpaceLayoutSheet`). A box hands its pane back through the same
 * store and closes the sheet; the chats underneath open it on their next
 * focus (`usePendingPaneOpen`), a commit after the pop, though the native
 * dismissal may still be animating. Never navigate from here right after
 * `router.back()`: the push would land in the same batch as the pop.
 */
export default function SpaceLayoutSheet() {
  const router = useRouter();
  const summary = useSpaceLayoutSheet((state) => state.summary);
  const { height } = useWindowDimensions();
  const close = () => router.back();
  const open = (pane: PaneOpen) => {
    useSpaceLayoutSheet.getState().request(pane);
    router.back();
  };

  return (
    <Screen presentation="sheet">
      <View style={{ padding: screenPadding, gap: spacing.md }}>
        <SpaceLayoutTitle
          title={summary === null ? 'Layout' : spaceTitle(summary)}
          stats={summary === null ? null : spaceStats(summary)}
          onClose={close}
          closeLabel="Done"
        />
        {/* "handled": a box's first tap opens it, even with a field focused. */}
        <ScrollView
          style={{ maxHeight: height * spaceLayout.sheetMaxWindowFraction }}
          keyboardShouldPersistTaps="handled"
          testID="space-layout-sheet">
          {summary !== null && <SpaceLayout summary={summary} onOpen={open} />}
        </ScrollView>
      </View>
    </Screen>
  );
}

/** The title row both presentations share: the workspace, its stats, and a way out. */
export function SpaceLayoutTitle({ title, stats, onClose, closeLabel }: {
  title: string;
  stats: string | null;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: minTouchTarget }}>
      <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
        <Text variant="headline" numberOfLines={1} accessibilityRole="header">{title}</Text>
        {stats !== null && <Text variant="caption" color="secondary" mono numberOfLines={1}>{stats}</Text>}
      </View>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={closeLabel === 'Done' ? 'Done' : 'Close layout'}
        hitSlop={spacing.sm}
        testID="space-layout-close">
        <Text variant="body" weight="600" color="tint">{closeLabel}</Text>
      </Pressable>
    </View>
  );
}
