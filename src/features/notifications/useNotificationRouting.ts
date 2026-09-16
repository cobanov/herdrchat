import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';

import { getPushDeviceId } from '@/features/notifications/deviceId';
import { openChat } from '@/features/chats/navigation';
import { deviceFileId, existingPushToken, uploadPushToken } from '@/features/notifications/push';
import { clientFor, isDemo, useConnections } from '@/state/connections';
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
      //
      // Concurrently, because these are independent machines and this runs at
      // launch. Serially, each unreachable host cost a full SEND_TIMEOUT_MS
      // before the next one was even dialled — three saved hosts off the tailnet
      // was about a minute of startup work to write the same short file three
      // times. Now the round takes as long as the slowest single host.
      await Promise.all(
        useConnections.getState().connections.map(async (target) => {
          if (isDemo(target.id)) return;
          try {
            await uploadPushToken(clientFor(target).transport, id, token, bundleId);
          } catch {
            /* unreachable host — it catches the next launch */
          }
        })
      );
    };

    void (async () => {
      // Never `requestPushToken` here: this runs off a stored setting, which is
      // not evidence that iOS was ever asked. See existingPushToken.
      const status = await existingPushToken();
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
  const hydrated = useConnections((state) => state.hydrated);
  useEffect(() => {
    // A launching notification may arrive before the saved host has loaded.
    // Do not bind the tablet selection to an empty connection id or mark that
    // tap as routed until we know which host owns it.
    if (!hydrated) return;
    const route = (response: Notifications.NotificationResponse) => {
      // Deduplicate on the tap, not on the code path that delivered it — see
      // `routed`. Marked before the target check so a payload we cannot route
      // is not reconsidered by the other path either.
      const id = response.notification.request.identifier;
      if (routed.has(id)) return;
      routed.add(id);

      const target = targetOf(response);
      if (target === null) return;
      openChat(useConnections.getState().selectedId ?? '', target.workspace, target.label);
    };

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response !== null) route(response);
    });
    const tap = Notifications.addNotificationResponseReceivedListener(route);
    return () => tap.remove();
  }, [hydrated]);
}

/**
 * Taps already routed, keyed by notification request identifier.
 *
 * A cold start from a notification is delivered TWICE. It resolves the
 * `getLastNotificationResponseAsync` promise, and expo-notifications also hands
 * the launching response to a listener registered afterwards. The previous latch
 * guarded only the promise, so the listener pushed a second copy of the same
 * thread: back had to be pressed twice, and two `useThread` instances polled one
 * workspace.
 *
 * A boolean could not fix that, because it has to stay false for later taps in
 * the same session and false is exactly what let the duplicate through. The
 * identifier distinguishes "this tap again" from "another tap", which is the
 * actual question.
 *
 * Module scope rather than a ref, for the reason the latch was module scope: the
 * last response outlives the tap that caused it, so a remount — Fast Refresh, a
 * layout re-key — re-reads it and would re-open the thread. Bounded by taps per
 * app launch, which is a handful.
 */
const routed = new Set<string>();
