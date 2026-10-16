import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Platform } from 'react-native';

import { useBadge } from '@/state/badge';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The three places the app is used from, as a real UIKit tab bar: the chats,
 * the files of the host and its machines, and a terminal on any of them.
 *
 * `NativeTabs` renders the system's own tab bar rather than a JS imitation,
 * which on iOS 26 is the floating Liquid Glass bar, with the way it minimises
 * as you scroll and blurs what passes beneath it. Hosts and Settings are not
 * tabs: they are visited a few times a week, and stay sheets opened from the
 * Chats header (b67d860 took the bar away while those were its tabs).
 *
 * The API is still `unstable_` and may change; the blast radius is one file.
 */
export default function TabsLayout() {
  const { colors } = useTheme();
  // Blocked agents plus unread threads, written by the chats list: with Files
  // or Terminal open, the badge is the one thing that still says a chat wants you.
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

      <NativeTabs.Trigger name="files">
        <NativeTabs.Trigger.Icon sf={{ default: 'folder', selected: 'folder.fill' }} md="folder" />
        <NativeTabs.Trigger.Label>Files</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="terminal">
        <NativeTabs.Trigger.Icon sf={{ default: 'terminal', selected: 'terminal.fill' }} md="terminal" />
        <NativeTabs.Trigger.Label>Terminal</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
