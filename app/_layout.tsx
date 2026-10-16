import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import { Suspense } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Booting } from '@/features/root/Booting';
import { RootStack } from '@/features/root/RootStack';
import { AppTheme } from '@/theme/AppTheme';
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
