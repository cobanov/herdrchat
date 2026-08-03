import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useTheme } from '@/theme/ThemeProvider';

/**
 * The three top-level destinations, as a real UIKit tab bar.
 *
 * `NativeTabs` renders the system's own tab bar rather than a JS imitation,
 * which on iOS 26 means the floating Liquid Glass bar — including the way it
 * minimises as you scroll and the way it blurs what passes beneath it. None of
 * that is reproducible in JS, and a hand-drawn approximation of a system
 * surface is exactly what makes an app read as not-quite-native.
 *
 * The API is still `unstable_` and may change; it is worth it here because the
 * alternative is worse, and the blast radius is one file.
 */
export default function TabsLayout() {
  const { colors } = useTheme();

  return (
    <NativeTabs
      tintColor={colors.tint}
      // The bar shrinks out of the way as the chat list scrolls, then comes
      // back on scroll-up — the iOS 26 behaviour people already expect.
      minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} />
        <NativeTabs.Trigger.Label>Chats</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="hosts">
        <NativeTabs.Trigger.Icon sf={{ default: 'server.rack', selected: 'server.rack' }} />
        <NativeTabs.Trigger.Label>Hosts</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
