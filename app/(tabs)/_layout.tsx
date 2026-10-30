import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Platform } from 'react-native';

import { useBadge } from '@/state/badge';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The two places the app is used from, as a real UIKit tab bar: the chats,
 * and the computers (every saved host) with their files and terminals.
 *
 * `NativeTabs` renders the system's own tab bar rather than a JS imitation,
 * which on iOS 26 is the floating Liquid Glass bar, with the way it minimises
 * as you scroll and blurs what passes beneath it. Hosts and Settings are not
 * tabs: they are visited a few times a week, and stay sheets opened from the
 * Chats header (b67d860 took the bar away while those were its tabs).
 *
 * On an iPhone Duo the system moves this bar into the strip on the right
 * edge (its cover screen, and the open screen in landscape), because it is a
 * real `UITabBarController`; a JS bar never would. That needs a build
 * against the iOS 27.1 SDK. The bar is never hidden here: on the Duo it
 * stands beside an open chat, not on its composer.
 *
 * The API is still `unstable_` and may change; the blast radius is one file.
 */
export default function TabsLayout() {
  const { colors } = useTheme();
  // Blocked agents plus unread threads, written by the chats list: with
  // Computers open, the badge is the one thing that still says a chat wants you.
  const attention = useBadge((state) => state.count);

  return (
    <NativeTabs
      tintColor={colors.tint}
      badgeBackgroundColor={colors.attention}
      minimizeBehavior={Platform.OS === 'ios' && Platform.isPad ? 'never' : 'onScrollDown'}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} md="forum" />
        <NativeTabs.Trigger.Label>Chats</NativeTabs.Trigger.Label>
        {/* Rendered conditionally rather than as an empty string: a badge whose
            value is falsy still reserves its dot on some iOS versions. */}
        {attention > 0 && <NativeTabs.Trigger.Badge>{String(attention)}</NativeTabs.Trigger.Badge>}
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="computers">
        <NativeTabs.Trigger.Icon sf={{ default: 'desktopcomputer', selected: 'desktopcomputer' }} md="computer" />
        <NativeTabs.Trigger.Label>Computers</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
