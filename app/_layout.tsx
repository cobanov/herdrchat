import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import * as SystemUI from 'expo-system-ui';
import { Suspense, useEffect, useMemo } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  useNotificationRouting,
  usePushTokenRefresh,
} from '@/features/notifications/useNotificationRouting';
import { AppTheme } from '@/theme/AppTheme';
import { useTheme } from '@/theme/ThemeProvider';
import { darkPalette, lightPalette } from '@/theme/tokens';
import { DATABASE_NAME, migrate } from '@/state/db';
import { Hydrate } from '@/state/Hydrate';

// Module scope, not an effect: iOS asks the handler what to do the moment a
// notification arrives, which can be before the first render commits. Without
// one, a push that lands while the app is FOREGROUND is silently swallowed.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * The chats are under every presented screen, even one reached cold by a link.
 * Without an anchor, `herdrchat://settings?section=…` (or `/hosts`) built a
 * stack of that sheet alone: Done's `back()` had nowhere to go, there was no
 * swipe-down on a root screen, and the welcome gate in `index` never ran. With
 * the tab bar there was always a way out; now the chats have to be put there.
 */
export const unstable_settings = { anchor: 'index' };

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Tracks the keyboard's real frame on the UI thread, every frame of it,
          including while a finger drags it down and when iPadOS shows only its
          input-assistant bar for a hardware keyboard. React Native's own
          keyboard events report neither; the thread's avoider reads this. */}
      <KeyboardProvider>
        <SafeAreaProvider>
          <Suspense fallback={<Booting />}>
            <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrate} useSuspense>
              <Hydrate>
                <AppTheme>
                  <StatusBar style="auto" />
                  <RootStack />
                </AppTheme>
              </Hydrate>
            </SQLiteProvider>
          </Suspense>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

/**
 * The navigator, split out so it sits INSIDE `AppTheme` and can read the scheme.
 *
 * Three surfaces have to be told what colour the app is, and none of them is a
 * screen. They were found one at a time, each revealed by fixing the one before
 * it — see `navigationTheme` below for the third:
 *
 * `contentStyle` is the navigator's own card. Its default is opaque white, and
 * during a push or a swipe-back you are looking at the card, not at the screen
 * drawn on it — which is why leaving a dark thread flashed white behind the
 * animation. Every screen already paints itself; this paints the thing they
 * animate on top of.
 *
 * `SystemUI.setBackgroundColorAsync` is the native window under the whole React
 * tree. It shows through wherever the card does not reach: behind a modal's
 * rounded corners, under an over-scroll, and in the frame between the splash
 * screen and the first render.
 */
function RootStack() {
  const { colors, scheme } = useTheme();

  // Inside every provider (database, stores), which the notification lifecycle
  // needs and the module scope above cannot reach.
  usePushTokenRefresh();
  useNotificationRouting();

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.systemBackground);
  }, [colors.systemBackground]);

  /**
   * The navigator's OWN theme, which is a third surface `contentStyle` does not
   * reach.
   *
   * Expo Router mounts its navigation container with React Navigation's default
   * theme unless it is given one, and that theme's background is
   * `rgb(242, 242, 242)` — a light grey, regardless of the app's scheme. It is
   * what remained visible behind a pop after the card itself was painted: less
   * obvious than the white it replaced, which is exactly why it survived the
   * first fix.
   *
   * Only the colours the navigator actually draws are overridden; the rest of
   * the base theme (fonts) is kept.
   */
  const navigationTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: colors.systemBackground,
        card: colors.systemBackground,
        text: colors.label,
        border: colors.separator,
        primary: colors.tint,
      },
    };
  }, [scheme, colors]);

  return (
    <ThemeProvider value={navigationTheme}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.systemBackground },
        }}>
        {/* The root: the chats. iPad keeps its selected conversation beside
            them on this same screen; only phones push the standalone thread
            route above it. There is no tab bar: Hosts and Settings are opened
            from the menu in the Chats header and presented below. */}
        <Stack.Screen name="index" />
        {/* `gestureEnabled` is the native-stack default, and it is stated here
            anyway. This is the only pushed screen in the app, its back control
            is one chevron in the corner, and it draws its own header — so a
            future `screenOptions` change could take the swipe away and nothing
            would notice. Written down, it is a decision; inherited, it was an
            accident that happened to be right. `.maestro/thread-back.yaml`
            checks it still works. */}
        <Stack.Screen name="chat/[workspaceId]" options={{ gestureEnabled: true }} />
        {/* Hosts and Settings are places you visit and come back from, so they
            are presented like the other full-height screens here rather than
            pushed: a sheet says "this goes away and you are back in your
            chats", and its Done control and swipe-down both do exactly that.
            `modal`, not `formSheet`, on iPad too: Settings keeps its section
            sidebar there (`AdaptiveColumns` reads the window, not the sheet),
            and a form sheet's narrow centred card would leave the detail
            column a sliver. Hosts opened from Settings' host card presents a
            second sheet over it, and picking a host dismisses both. */}
        <Stack.Screen name="hosts" options={{ presentation: 'modal' }} />
        <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
        <Stack.Screen name="server/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="new-chat" options={{ presentation: 'modal' }} />
        <Stack.Screen name="folder-picker" options={{ presentation: 'modal' }} />
        {/* Full screen and no swipe down: it ends with a choice (the Demo or
            your own computer), and Skip is one tap away. */}
        <Stack.Screen name="welcome" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
        {/* A form sheet rather than a full modal: it is one field, and a sheet
            that only takes the height it needs keeps the list it renamed
            visible behind it.

            `fitToContents`, NOT a fixed fraction. This was `[0.4]`, and 40% of
            an iPhone is about 350pt — while the keyboard, which this screen
            raises immediately because the field is autofocused, is about 340pt.
            The sheet was almost entirely behind the keyboard. Letting UIKit size
            it to its content is both correct and one fewer number to be wrong. */}
        <Stack.Screen
          name="rename-chat"
          options={{ presentation: 'formSheet', sheetAllowedDetents: 'fitToContents' }}
        />
      </Stack>
    </ThemeProvider>
  );
}

/**
 * Shown while the database opens. Outside `AppTheme` by necessity — the theme
 * provider needs the database this is waiting on — so it reads the system scheme
 * directly rather than going without a background and flashing white.
 */
function Booting() {
  const scheme = useColorScheme();
  const colors = scheme === 'dark' ? darkPalette : lightPalette;
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.systemBackground,
      }}>
      <ActivityIndicator color={colors.tint} />
    </View>
  );
}
