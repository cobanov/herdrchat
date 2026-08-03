import Constants from 'expo-constants';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { Button } from '@/components/Button';
import { SegmentedField } from '@/components/Field';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Toggle } from '@/components/Toggle';
import { useGlassAvailable } from '@/components/Glass';
import { HerdrError } from '@/lib/herdr/protocol';
import { runtimeReport } from '@/lib/runtimeReport';
import {
  deviceFileId,
  errorDetail,
  removePushToken,
  requestPushToken,
  uploadPushToken,
} from '@/features/notifications/push';
import { clientFor, useConnections, useSelectedConnection } from '@/state/connections';
import { cachedMessageCount, clearCachedMessages, setSetting } from '@/state/db';
import { encodeBool, useSettings, type Settings } from '@/state/settings';
import { useTheme, type ThemePreference } from '@/theme/ThemeProvider';
import { radius, screenPadding, spacing } from '@/theme/tokens';

/**
 * Settings.
 *
 * Deliberately short. Everything that could live here and doesn't is either a
 * per-host setting (which belongs on the host) or a preference the system
 * already owns.
 */
export default function SettingsScreen() {
  const db = useSQLiteContext();
  const { reduceMotion, reduceTransparency } = useTheme();
  const glass = useGlassAvailable();
  const settings = useSettings();
  const connection = useSelectedConnection();
  const connections = useConnections((state) => state.connections);

  // Read once: these are globals installed before the first render and they do
  // not change while the app is running.
  const newArchitecture = useMemo(() => {
    const report = runtimeReport();
    const missing = (Object.keys(report) as (keyof typeof report)[]).filter((k) => !report[k]);
    return missing.length === 0 ? 'on' : `partial — no ${missing.join(', ')}`;
  }, []);

  const [cached, setCached] = useState<number | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  // `detail` carries the underlying error. A TestFlight build has no console,
  // so the screen is the only place a failure can be read.
  const [pushNote, setPushNote] = useState<{ message: string; detail?: string } | null>(null);

  const refreshCacheSize = useCallback(() => {
    void cachedMessageCount(db).then(setCached);
  }, [db]);
  useEffect(refreshCacheSize, [refreshCacheSize]);

  /** Persist alongside the store, so the mirror never drifts from the source. */
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    settings.set(key, value);
    void setSetting(db, key, typeof value === 'boolean' ? encodeBool(value) : String(value));
  };

  const toggleNotifications = async (next: boolean) => {
    setPushBusy(true);
    setPushNote(null);
    try {
      const id = deviceFileId(Constants.sessionId ?? 'device');

      if (!next) {
        // Best-effort removal: if a host is unreachable the local switch still
        // turns off, and a stale token there is harmless — APNs reports it as
        // unregistered and the watcher drops it.
        for (const target of connections) {
          try {
            await removePushToken(clientFor(target).transport, id);
          } catch {
            /* unreachable host */
          }
        }
        update('notifications', false);
        return;
      }

      const status = await requestPushToken();
      if (status.state === 'unsupported') {
        setPushNote({ message: status.reason, detail: status.detail });
        return;
      }
      if (status.state === 'denied') {
        setPushNote({ message: 'Notifications are turned off for HerdrChat in iOS Settings.' });
        return;
      }
      if (connection === null) {
        setPushNote({ message: 'Add a host first — the token is stored on your own machine.' });
        return;
      }

      const bundleId = Constants.expoConfig?.ios?.bundleIdentifier ?? '';
      await uploadPushToken(clientFor(connection).transport, id, status.token, bundleId);
      update('notifications', true);
      setPushNote({ message: `Registered with ${connection.name}. Run the watcher on that machine.` });
    } catch (thrown) {
      // A HerdrError already says something a person can act on. Anything else
      // is a raw throw, so it goes in the detail line rather than becoming the
      // headline.
      setPushNote(
        thrown instanceof HerdrError
          ? { message: thrown.message }
          : {
              message: "Couldn't register this device with the host.",
              detail: errorDetail(thrown),
            }
      );
    } finally {
      setPushBusy(false);
    }
  };

  const confirmClearCache = () => {
    Alert.alert(
      'Clear cached messages?',
      'Threads reload from each host next time you open them. Nothing on your machines changes.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            void clearCachedMessages(db).then(refreshCacheSize);
          },
        },
      ]
    );
  };

  return (
    <Screen>
      <Header title="Settings" />

      <ScrollView
        contentContainerStyle={{
          padding: screenPadding,
          gap: spacing.xl,
          paddingBottom: spacing.xxxl * 2,
        }}>
        <SegmentedField<ThemePreference>
          label="Appearance"
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          value={settings.themePreference}
          onChange={(next) => update('themePreference', next)}
        />

        <Section title="Conversations">
          <Toggle
            label="Tool activity"
            detail="Show tool calls, results and thinking as chips inside messages."
            value={settings.showToolActivity}
            onChange={(next) => update('showToolActivity', next)}
            testID="toggle-tool-activity"
          />
          <Divider />
          <Toggle
            label="Subagent messages"
            detail="Include sidechain turns from subagents the main agent spawned."
            value={settings.showSidechain}
            onChange={(next) => update('showSidechain', next)}
            testID="toggle-sidechain"
          />
          <Divider />
          <Toggle
            label="Haptics"
            detail="Feedback on sends, quick replies and toggles."
            value={settings.haptics}
            onChange={(next) => update('haptics', next)}
            testID="toggle-haptics"
          />
        </Section>

        <Section
          title="Notifications"
          footer="Your phone registers its push token on the host over SSH, and a watcher there notifies you when an agent blocks or finishes. Nothing passes through a server of ours — you run the watcher yourself. See scripts/herdr-apns-notifier.py.">
          <Toggle
            label="Notify when an agent needs me"
            detail="Blocked or finished agents, pushed from your own machine."
            value={settings.notifications}
            onChange={(next) => void toggleNotifications(next)}
            disabled={pushBusy}
            testID="toggle-notifications"
          />
          {pushNote !== null && (
            <View style={{ paddingTop: spacing.sm, gap: spacing.xs }}>
              <Text variant="footnote" color="secondary">
                {pushNote.message}
              </Text>
              {/* Smaller, not fainter: this is the line you read to diagnose a
                  failed registration, so hierarchy comes from size rather than
                  from an alpha that would undercut its contrast. */}
              {pushNote.detail !== undefined && (
                <Text variant="caption" color="secondary">
                  {pushNote.detail}
                </Text>
              )}
            </View>
          )}
        </Section>

        <Section title="Storage">
          <View style={{ gap: spacing.md, paddingVertical: spacing.xs }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="body">Cached messages</Text>
              <Text variant="body" color="secondary">
                {cached === null ? '—' : cached.toLocaleString()}
              </Text>
            </View>
            <Button
              title="Clear cache"
              variant="tinted"
              onPress={confirmClearCache}
              disabled={cached === 0}
              testID="clear-cache"
            />
          </View>
        </Section>

        <Section title="About">
          <Row label="Version" value={Constants.expoConfig?.version ?? '—'} />
          <Row label="Build" value={String(Constants.expoConfig?.ios?.buildNumber ?? '—')} />
          {/* Surfaced rather than hidden: whether the OS actually granted the
              glass API is the difference between the design people were shown
              and the one they got, and it varies by build. */}
          <Row label="Liquid Glass" value={glass ? 'on' : 'unavailable'} />
          {/* The build asks for the New Architecture in app.json; this is what
              the running JS engine actually reports. A request and an answer are
              different things, and only one of them is worth showing. */}
          <Row label="New Architecture" value={newArchitecture} />
          <Row label="Reduce Motion" value={reduceMotion ? 'on' : 'off'} />
          <Row label="Reduce Transparency" value={reduceTransparency ? 'on' : 'off'} />
        </Section>

        <Text variant="caption" color="secondary">
          HerdrChat reaches your machines over SSH on your tailnet. Keys are stored in the device
          keychain and never leave it; nothing is sent to any server of ours, because there isn’t
          one.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Section({
  title,
  footer,
  children,
}: {
  title: string;
  footer?: string;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="footnote" color="secondary">
        {title}
      </Text>
      <View
        style={{
          borderRadius: radius.sm,
          backgroundColor: colors.secondarySystemBackground,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        }}>
        {children}
      </View>
      {footer !== undefined && (
        <Text variant="caption" color="secondary">
          {footer}
        </Text>
      )}
    </View>
  );
}

function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.separator, opacity: 0.6 }} />;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: spacing.md,
        paddingVertical: spacing.xs,
      }}>
      <Text variant="subhead" color="secondary">
        {label}
      </Text>
      <Text variant="subhead">{value}</Text>
    </View>
  );
}
