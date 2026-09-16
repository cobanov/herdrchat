import Constants from 'expo-constants';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { Button } from '@/components/Button';
import { ROW_INSET, Section } from '@/components/SettingsList';
import { Text } from '@/components/Text';
import { Toggle } from '@/components/Toggle';
import { getPushDeviceId } from '@/features/notifications/deviceId';
import {
  deviceFileId,
  errorDetail,
  removePushToken,
  existingPushToken,
  requestPushToken,
  uploadPushToken,
} from '@/features/notifications/push';
import { HerdrError } from '@/lib/herdr/protocol';
import { clientFor, isDemo, useConnections, useSelectedConnection } from '@/state/connections';
import { setSetting } from '@/state/db';
import { encodeBool, useSettings } from '@/state/settings';
import { spacing } from '@/theme/tokens';

/**
 * Push notifications, and the several distinct ways turning them on can fail.
 *
 * Each failure means something different and each has a different next step, so
 * the note below the switch says which one happened. A TestFlight build has no
 * console; this screen is the only place a registration failure can be read.
 */
export function NotificationsSection() {
  const db = useSQLiteContext();
  const enabled = useSettings((state) => state.notifications);
  const connection = useSelectedConnection();
  const connections = useConnections((state) => state.connections);

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{
    message: string;
    detail?: string;
    /** True when iOS owns the switch, so the app can only point at it. */
    systemDenied?: boolean;
  } | null>(null);

  const toggle = async (next: boolean) => {
    if (next && (connection === null || isDemo(connection.id))) {
      setNote({ message: 'Select your own host first. The Demo host cannot send notifications.' });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const id = deviceFileId(await getPushDeviceId(db));

      if (!next) {
        // The token itself is needed too: earlier builds wrote one file per
        // LAUNCH (named after Constants.sessionId), so removing today's file
        // leaves legacy copies the watcher still pushes to. removePushToken
        // deletes every file carrying this token.
        //
        // Read, never request. This said permission "is already granted while
        // the toggle is on", which describes the setting rather than the OS: a
        // restored database can have the toggle on with iOS never asked, and
        // then turning notifications OFF popped a dialog asking to turn them on.
        // Without a token removePushToken still deletes today's file, which is
        // the common case anyway.
        const status = await existingPushToken();
        const token = status.state === 'granted' ? status.token : null;
        // Best-effort removal, and concurrent: the switch should not sit under a
        // spinner for one timeout per unreachable host. If a host is missed the
        // stale token there is harmless — APNs reports it as unregistered and
        // the watcher drops it.
        await Promise.all(
          connections.map(async (target) => {
            if (isDemo(target.id)) return;
            try {
              await removePushToken(clientFor(target).transport, id, token);
            } catch {
              /* unreachable host */
            }
          })
        );
        persist(false);
        return;
      }

      const status = await requestPushToken();
      if (status.state === 'unsupported') {
        setNote({ message: status.reason, detail: status.detail });
        return;
      }
      if (status.state === 'denied') {
        // The one failure the app cannot fix from here, so it offers the only
        // thing that helps: a way straight to the switch that is off. Naming the
        // screen and leaving someone to find it was the previous behaviour, and
        // it is exactly what a deep link is for.
        setNote({
          message: 'Notifications are turned off for HerdrChat in iOS Settings.',
          systemDenied: true,
        });
        return;
      }
      if (connection === null) return;

      const bundleId = Constants.expoConfig?.ios?.bundleIdentifier ?? '';
      await uploadPushToken(clientFor(connection).transport, id, status.token, bundleId);
      persist(true);
      setNote({
        message: `Registered with ${connection.name}. Run the watcher on that machine.`,
      });
    } catch (thrown) {
      // A HerdrError already says something a person can act on. Anything else
      // is a raw throw, so it goes in the detail line rather than becoming the
      // headline.
      setNote(
        thrown instanceof HerdrError
          ? { message: thrown.message }
          : {
              message: "Couldn't register this device with the host.",
              detail: errorDetail(thrown),
            }
      );
    } finally {
      setBusy(false);
    }
  };

  /** Persist alongside the store, so the mirror never drifts from the source. */
  const persist = (value: boolean) => {
    useSettings.getState().set('notifications', value);
    void setSetting(db, 'notifications', encodeBool(value));
  };

  return (
    <Section
      title="Notifications"
      footer="Your phone registers its push token on the host over SSH, and a watcher there notifies you when an agent blocks or finishes. Nothing passes through a server of ours — you run the watcher yourself. See scripts/herdr-apns-notifier.py.">
      <Toggle
        label="Notify when an agent needs me"
        detail="Blocked or finished agents, pushed from your own machine."
        value={enabled}
        onChange={(next) => void toggle(next)}
        disabled={busy}
        testID="toggle-notifications"
      />
      {note !== null && (
        <View
          style={{
            paddingHorizontal: ROW_INSET,
            paddingTop: spacing.xs,
            paddingBottom: spacing.xs,
            gap: spacing.xs,
          }}>
          <Text variant="footnote" color="secondary">
            {note.message}
          </Text>
          {/* Smaller, not fainter: this is the line you read to diagnose a
              failed registration, so hierarchy comes from size rather than
              from an alpha that would undercut its contrast. */}
          {note.detail !== undefined && (
            <Text variant="caption" color="secondary">
              {note.detail}
            </Text>
          )}
          {note.systemDenied === true && (
            <Button
              title="Open iOS Settings"
              variant="tinted"
              onPress={() => void Linking.openSettings()}
              testID="open-ios-settings"
            />
          )}
        </View>
      )}
    </Section>
  );
}
