import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import { Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '@/theme/ThemeProvider';
import { DATABASE_NAME, migrate } from '@/state/db';
import { Hydrate } from '@/state/Hydrate';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Suspense fallback={<Booting />}>
          <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrate} useSuspense>
            <ThemeProvider>
              <Hydrate>
                <StatusBar style="auto" />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    // Native sheets rather than JS modals: the system already
                    // knows how a sheet should feel, including the grabber, the
                    // detents and the dismiss gesture.
                    presentation: 'card',
                  }}>
                  <Stack.Screen name="index" />
                  <Stack.Screen name="chat/[workspaceId]" />
                  <Stack.Screen name="servers" options={{ presentation: 'modal' }} />
                  <Stack.Screen name="server/[id]" options={{ presentation: 'modal' }} />
                  <Stack.Screen name="new-chat" options={{ presentation: 'modal' }} />
                  <Stack.Screen name="folder-picker" options={{ presentation: 'modal' }} />
                </Stack>
              </Hydrate>
            </ThemeProvider>
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
