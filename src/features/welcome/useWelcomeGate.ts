import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef } from 'react';

import { decodeActiveDays, encodeActiveDays, localDay, recordActiveDay, shouldShowWelcome } from '@/lib/welcome';
import { isDemo, useConnections, useSelectedConnection } from '@/state/connections';
import { saveSetting } from '@/state/saveSetting';
import { useSettings } from '@/state/settings';

/**
 * Opens the welcome on a first launch: once the saved state is read, nothing
 * has been set up, and it has not been seen. Also counts the days the app is
 * opened on a real host, which is what the one-time star card waits for.
 * Called from the root chats screen (`app/index.tsx`), which is always
 * underneath, so it runs once with navigation ready.
 */
export function useWelcomeGate(): void {
  const router = useRouter();
  const db = useSQLiteContext();
  const hydrated = useConnections((state) => state.hydrated);
  const hostCount = useConnections((state) => state.connections.filter((connection) => !isDemo(connection.id)).length);
  const welcomeSeen = useSettings((state) => state.welcomeSeen);
  const selected = useSelectedConnection();
  const onRealHost = selected !== null && !isDemo(selected.id);
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current || !shouldShowWelcome({ hydrated, welcomeSeen, hostCount })) return;
    opened.current = true;
    router.push('/welcome');
  }, [router, hydrated, welcomeSeen, hostCount]);

  useEffect(() => {
    if (!hydrated || !onRealHost) return;
    const before = decodeActiveDays(useSettings.getState().activeDays);
    const after = recordActiveDay(before, localDay(new Date()));
    if (after !== before) saveSetting(db, 'activeDays', encodeActiveDays(after));
  }, [db, hydrated, onRealHost]);
}
