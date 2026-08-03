import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import { Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppTheme } from '@/theme/AppTheme';
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
                <Stack screenOptions={{ headerShown: false }}>
                  {/* The tab bar lives inside this group, so a conversation
                      pushed from here covers it — the way Messages does. */}
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="chat/[workspaceId]" />
                  <Stack.Screen name="server/[id]" options={{ presentation: 'modal' }} />
                  <Stack.Screen name="new-chat" options={{ presentation: 'modal' }} />
                  <Stack.Screen name="folder-picker" options={{ presentation: 'modal' }} />
                </Stack>
              </AppTheme>
            </Hydrate>
          </SQLiteProvider>
        </Suspense>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Booting() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}
