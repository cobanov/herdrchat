import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import * as SystemUI from 'expo-system-ui';
import { Suspense, useEffect } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppTheme } from '@/theme/AppTheme';
import { useTheme } from '@/theme/ThemeProvider';
import { darkPalette, lightPalette } from '@/theme/tokens';
import { DATABASE_NAME, migrate } from '@/state/db';
import { Hydrate } from '@/state/Hydrate';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
    </GestureHandlerRootView>
  );
}

/**
 * The navigator, split out so it sits INSIDE `AppTheme` and can read the scheme.
 *
 * Two different surfaces have to be told what colour the app is, and neither of
 * them is a screen:
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
  const { colors } = useTheme();

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.systemBackground);
  }, [colors.systemBackground]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.systemBackground },
      }}>
      {/* The tab bar lives inside this group, so a conversation
          pushed from here covers it — the way Messages does. */}
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="chat/[workspaceId]" />
      <Stack.Screen name="server/[id]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="new-chat" options={{ presentation: 'modal' }} />
      <Stack.Screen name="folder-picker" options={{ presentation: 'modal' }} />
    </Stack>
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
