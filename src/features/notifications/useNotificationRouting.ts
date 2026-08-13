import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';

import { getPushDeviceId } from '@/features/notifications/deviceId';
import { deviceFileId, requestPushToken, uploadPushToken } from '@/features/notifications/push';
import { clientFor, useConnections } from '@/state/connections';
import { useSettings } from '@/state/settings';

/**
 * The notification lifecycle outside the Settings screen: keeping every host's
 * copy of the token fresh, and turning a tapped notification into the thread it
 * is about. Both are mounted once, from the root layout.
 */

/**
 * Re-register the token on launch and on rotation.
 *
 * The Settings toggle uploads once, to the selected host, on the day it was
 * flipped — but APNs rotates tokens (restore, reinstall, OS update), and hosts
 * added later never saw one. So while notifications are on: silently re-request
 * the token (permission was granted when the toggle went on) and write it to
 * every saved connection, best-effort per host — an unreachable host misses
 * this round and catches the next launch.
 */
export function usePushTokenRefresh(): void {
  const db = useSQLiteContext();
  const enabled = useSettings((state) => state.notifications);
  const hydrated = useConnections((state) => state.hydrated);

  useEffect(() => {
    if (!enabled || !hydrated) return;
    let cancelled = false;

    const upload = async (token: string) => {
      const id = deviceFileId(await getPushDeviceId(db));
      const bundleId = Constants.expoConfig?.ios?.bundleIdentifier ?? '';
      // Read at upload time rather than subscribed: a connections change
      // shouldn't re-run the whole effect and re-request the token.
      for (const target of useConnections.getState().connections) {
        try {
          await uploadPushToken(clientFor(target).transport, id, token, bundleId);
        } catch {
          /* unreachable host */
        }
      }
    };

    void (async () => {
      const status = await requestPushToken();
      if (!cancelled && status.state === 'granted') await upload(status.token);
    })();
    const rotation = Notifications.addPushTokenListener((token) => {
      void upload(String(token.data));
    });
    return () => {
      cancelled = true;
      rotation.remove();
    };
  }, [db, enabled, hydrated]);
}

/** What the watcher puts beside `aps` — see scripts/herdr-apns-notifier.py. */
interface PushTarget {
  workspace: string;
  label: string | undefined;
}

/**
 * The custom keys, wherever this platform surfaced them: `content.data` where
 * expo-notifications maps them, else the raw APNs payload on the iOS trigger.
 */
function targetOf(response: Notifications.NotificationResponse): PushTarget | null {
  const request = response.notification.request;
  const trigger: unknown = request.trigger;
  const payload =
    typeof trigger === 'object' && trigger !== null && 'payload' in trigger
      ? (trigger as { payload?: unknown }).payload
      : undefined;
  const raw: Record<string, unknown> = {
    ...(typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}),
    ...(request.content.data ?? {}),
  };
  const workspace = raw['workspace'];
  if (typeof workspace !== 'string' || workspace.length === 0) return null;
  const label = raw['label'];
  return { workspace, label: typeof label === 'string' ? label : undefined };
}

/**
 * Route a tapped notification to its thread — both the warm path (listener) and
 * the cold start, where the tap is what launched the app and arrives via
 * `getLastNotificationResponseAsync` instead.
 *
 * The payload names a workspace but not a host, so the thread opens against the
 * currently selected connection — right whenever one host runs the watcher,
 * which is the shipped setup.
 */
export function useNotificationRouting(): void {
  const router = useRouter();

  useEffect(() => {
    const route = (response: Notifications.NotificationResponse) => {
      const target = targetOf(response);
      if (target === null) return;
      router.push({
        pathname: '/chat/[workspaceId]',
        params:
          target.label !== undefined
            ? { workspaceId: target.workspace, title: target.label }
            : { workspaceId: target.workspace },
      });
    };

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response !== null && !coldStartRouted) {
        coldStartRouted = true;
        route(response);
      }
    });
    const tap = Notifications.addNotificationResponseReceivedListener(route);
    return () => tap.remove();
  }, [router]);
}

/**
 * The last response outlives the tap that caused it, so a remount (Fast
 * Refresh, layout re-key) would re-open the thread without this latch.
 */
let coldStartRouted = false;
