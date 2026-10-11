import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import type { ListedChat } from '@/features/chats/listedChat';
import {
  paneAccessibilityLabel,
  spaceLayoutModel,
  tabAccessibilityLabel,
  type LayoutPane,
  type LayoutTab,
} from '@/lib/spaces/layout';
import { useTheme } from '@/theme/ThemeProvider';
import { avatarColor, spaceLayout } from '@/theme/tokens';
import { canOpenPane, openPane } from './openPane';

/**
 * A workspace's layout in basic shapes: each tab a rounded rectangle, titled,
 * with its panes as boxes where they sit on the desktop. An agent's box is
 * filled in its provider's avatar colour (the attention colour while it needs
 * you), a shell's in a neutral fill; the focused pane is ringed in the tint.
 * A tab zoomed on one pane draws that pane alone, with a zoom mark.
 *
 * Tapping a box closes the view (`onClose`) and opens the pane: an agent's
 * chat, or any other pane's terminal.
 *
 * Shared by the phone's sheet and the iPad's floating card, which differ only
 * in what holds it.
 */
export function SpaceLayout({ summary, onClose }: { summary: ListedChat; onClose: () => void }) {
  const tabs = useMemo(() => spaceLayoutModel(summary), [summary]);
  // Measured, not the window's: the card and the sheet are narrower.
  const [width, setWidth] = useState(0);
  const columns = tabs.length >= spaceLayout.twoColumnsFrom ? 2 : 1;
  const tabWidth = Math.max(0, (width - spaceLayout.tabGap * (columns - 1)) / columns);

  if (tabs.length === 0) {
    return (
      <Text variant="footnote" color="secondary" testID="layout-empty">
        herdr on this computer does not report its layout.
      </Text>
    );
  }
  return (
    <View
      testID={`layout-${summary.workspaceId}`}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spaceLayout.tabGap }}>
      {width > 0 && tabs.map((tab) => (
        <TabShape key={tab.tabId} tab={tab} width={tabWidth} summary={summary} onClose={onClose} />
      ))}
    </View>
  );
}

function TabShape({ tab, width, summary, onClose }: {
  tab: LayoutTab;
  width: number;
  summary: ListedChat;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  // herdr measures in cells, which are taller than wide (`cellAspect`).
  const aspect = tab.columns > 0 && tab.rows > 0
    ? Math.min(spaceLayout.maxAspect, Math.max(spaceLayout.minAspect, (tab.columns * spaceLayout.cellAspect) / tab.rows))
    : spaceLayout.fallbackAspect;
  const height = width / aspect;
  const innerWidth = width - spaceLayout.tabInset * 2;
  const innerHeight = height - spaceLayout.tabInset * 2;

  return (
    <View style={{ width, gap: spaceLayout.titleGap }} testID={`layout-tab-${tab.tabId}`}>
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={tabAccessibilityLabel(tab)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spaceLayout.titleGap }}>
        <Text variant="caption" weight="600" color={tab.active ? 'label' : 'secondary'} numberOfLines={1} style={{ flexShrink: 1 }}>
          {tab.title}
        </Text>
        {tab.zoomed && (
          <Icon name="arrow.up.left.and.arrow.down.right" size={spaceLayout.zoomGlyph} tintColor={colors.secondaryLabel} />
        )}
      </View>
      <View
        style={{
          width, height,
          borderRadius: spaceLayout.tabRadius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: tab.active ? colors.tint : colors.separator,
          backgroundColor: colors.chatCard,
        }}>
        {tab.panes.map((pane) => (
          <PaneBox
            key={pane.paneId}
            pane={pane}
            left={spaceLayout.tabInset + pane.x * innerWidth + spaceLayout.paneGap / 2}
            top={spaceLayout.tabInset + pane.y * innerHeight + spaceLayout.paneGap / 2}
            width={Math.max(0, pane.width * innerWidth - spaceLayout.paneGap)}
            height={Math.max(0, pane.height * innerHeight - spaceLayout.paneGap)}
            summary={summary}
            onClose={onClose}
          />
        ))}
      </View>
    </View>
  );
}

function PaneBox({ pane, left, top, width, height, summary, onClose }: {
  pane: LayoutPane;
  left: number;
  top: number;
  width: number;
  height: number;
  summary: ListedChat;
  onClose: () => void;
}) {
  const { colors, avatarPalette } = useTheme();
  const agent = pane.kind === 'agent';
  const fill = !agent ? colors.fillSubtle
    : pane.status === 'blocked' ? colors.attention : avatarColor(pane.agent ?? pane.label, avatarPalette);
  const openable = canOpenPane(summary, pane);
  return (
    <Pressable
      testID={`layout-pane-${pane.paneId}`}
      onPress={() => openPane(summary, pane, onClose)}
      disabled={!openable}
      accessibilityRole="button"
      accessibilityLabel={paneAccessibilityLabel(pane)}
      accessibilityHint={agent ? 'Opens its chat' : "Opens the pane's terminal"}
      accessibilityState={{ disabled: !openable, selected: pane.focused }}
      style={({ pressed }) => ({
        position: 'absolute', left, top, width, height,
        overflow: 'hidden',
        padding: spaceLayout.paneGap,
        borderRadius: spaceLayout.paneRadius,
        borderWidth: pane.focused ? spaceLayout.focusRing : StyleSheet.hairlineWidth,
        borderColor: pane.focused ? colors.tint : colors.separator,
        backgroundColor: fill,
        opacity: pressed ? spaceLayout.pressedOpacity : 1,
      })}>
      <Text variant="caption2" weight="600" color={agent ? 'onTint' : 'secondary'} numberOfLines={1}>{pane.label}</Text>
      {pane.detail !== null && (
        <Text variant="caption2" color={agent ? 'onTint' : 'secondary'} numberOfLines={2}>{pane.detail}</Text>
      )}
    </Pressable>
  );
}
