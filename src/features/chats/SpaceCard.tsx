import { memo, useRef } from 'react';
import { Pressable, View } from 'react-native';

import { HoverView } from '../../../modules/herdr-keys/src/hover';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import type { LayoutAnchor } from '@/features/spaces/LayoutPeek';
import { useHoverIntent } from '@/features/spaces/useHoverIntent';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, motion, radius, size, spaceLayout, spacing } from '@/theme/tokens';
import { StatusMark } from './StatusMark';
import { useDeviceIcon } from '@/state/deviceIcons';
import { AVATAR_SIZE, type RowAction } from './ChatRow';
import { rowTestKey, type HostRef } from './listedChat';
import { spaceStats, spaceTitle, statusLabel } from './rowText';
import type { ChatSummary } from './useWorkspaces';

/**
 * A workspace's card in Spaces when it holds more than one agent, or an
 * agent and anything else (`spaceCardMode`): the workspace, not a chat. Its
 * label, a line of stats, and a button that shows its layout; its agents and
 * terminals are the rows under it.
 *
 * Drawn as `ChatRow` draws a card, same padding, badge and corner, so the
 * rows hung off it line up with its rail. Tapping it shows the layout too;
 * on iPad a pointer resting on the button shows it while it stays there
 * (`HoverView`: `Pressable`'s own hover never fires on iOS here). A herdr
 * that reports no tabs or layouts gets no button: the view would only say
 * so. Its attention border and unread dot are its agents' together, as before.
 */
export const SpaceCard = memo(function SpaceCard({
  summary, testKey, unread, pinned = false, muted = false, onOpenLayout, onHoverLayout, onLeaveLayout, onLongPress, actions = [],
}: {
  summary: ChatSummary & { host?: HostRef | null; connectionId?: string };
  testKey?: string;
  unread: boolean;
  pinned?: boolean;
  muted?: boolean;
  /** The card or its button was tapped; `anchor` is the button, for a card drawn beside it. */
  onOpenLayout: (anchor: LayoutAnchor) => void;
  /** A pointer came to rest on the button (iPad); absent where there is no pointer to speak of. */
  onHoverLayout?: (anchor: LayoutAnchor) => void;
  onLeaveLayout?: () => void;
  onLongPress?: () => void;
  /** Offered to VoiceOver and Voice Control: the swipe's actions (`ChatRow`). */
  actions?: readonly RowAction[];
}) {
  const { colors } = useTheme();
  const button = useRef<View>(null);
  const attention = summary.status === 'blocked';
  const title = spaceTitle(summary);
  const stats = spaceStats(summary);
  const deviceIcon = useDeviceIcon(summary.connectionId);
  const key = testKey ?? rowTestKey(summary);
  const restoreFailed = summary.restoreError !== null ? `Couldn't restore. ${summary.restoreError}` : null;
  const hasLayout = summary.tabs.length > 0 || summary.layouts.length > 0;
  const hover = useHoverIntent({
    onIn: onHoverLayout === undefined ? undefined : () => onHoverLayout(button),
    onOut: onLeaveLayout,
    delayIn: motion.hoverIn,
    delayOut: motion.hoverOut,
  });

  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'stretch',
        borderRadius: radius.sm, borderWidth: 1,
        borderColor: attention ? colors.attentionBorder : 'transparent',
        backgroundColor: colors.chatCard,
      }}>
      <Pressable
        // Nothing to show without a layout: the agents under it are the way in.
        onPress={hasLayout ? () => onOpenLayout(button) : undefined}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityHint={hasLayout ? 'Shows its tabs and panes' : undefined}
        accessibilityActions={actions.map(({ name, label }) => ({ name, label }))}
        onAccessibilityAction={(event) => {
          actions.find((action) => action.name === event.nativeEvent.actionName)?.run();
        }}
        accessibilityLabel={[title, pinned ? 'Pinned' : '', muted ? 'Muted' : '', stats, statusLabel(summary.status), unread ? 'Unread' : '', restoreFailed ?? ''].filter(Boolean).join(', ')}
        testID={`chat-row-${key}`}
        style={({ pressed }) => ({
          flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
          padding: spacing.md, paddingRight: hasLayout ? spacing.xs : spacing.md,
          borderTopLeftRadius: radius.sm, borderBottomLeftRadius: radius.sm,
          backgroundColor: pressed ? colors.chatCardPressed : 'transparent',
        })}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: radius.sm, backgroundColor: colors.tintMuted, alignItems: 'center', justifyContent: 'center' }}>
          {/* The computer's glyph when one was given in Hosts, as a chat's row has it. */}
          <Icon name={deviceIcon ?? 'square.stack.3d.up'} size={size.chatBadgeGlyph} tintColor={colors.tint} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Text variant="headline" numberOfLines={2} style={{ flexShrink: 1 }}>{title}</Text>
            {pinned && <Icon name="pin.fill" size={size.rowBadgeGlyph} tintColor={colors.secondaryLabel} />}
            {muted && <Icon name="bell.slash.fill" size={size.rowBadgeGlyph} tintColor={colors.secondaryLabel} />}
          </View>
          <Text variant="caption" color={attention ? 'attention' : 'secondary'} mono numberOfLines={2}>{stats}</Text>
          {restoreFailed !== null && (
            <Text variant="footnote" color="destructive" numberOfLines={2} testID="chat-row-restore-error">{restoreFailed}</Text>
          )}
        </View>
        <StatusMark status={summary.status} unread={unread} />
      </Pressable>
      {hasLayout && (
        <HoverView onHoverChange={hover} style={{ justifyContent: 'center', marginRight: spacing.xs }}>
          <Pressable
            ref={button}
            onPress={() => onOpenLayout(button)}
            accessibilityRole="button"
            accessibilityLabel="Show layout"
            testID={`space-layout-${key}`}
            style={({ pressed }) => ({
              width: minTouchTarget, minHeight: minTouchTarget,
              alignItems: 'center', justifyContent: 'center',
              borderRadius: radius.sm,
              backgroundColor: pressed ? colors.chatCardPressed : 'transparent',
            })}>
            <Icon name="rectangle.split.2x2" size={spaceLayout.buttonGlyph} tintColor={colors.tint} />
          </Pressable>
        </HoverView>
      )}
    </View>
  );
});
