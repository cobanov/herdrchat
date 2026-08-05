import Constants from 'expo-constants';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { Button } from '@/components/Button';
import { SegmentedField } from '@/components/Field';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Toggle } from '@/components/Toggle';
import { HerdrError } from '@/lib/herdr/protocol';
import {
  deviceFileId,
  errorDetail,
  removePushToken,
  requestPushToken,
  uploadPushToken,
} from '@/features/notifications/push';
import { clientFor, useConnections, useSelectedConnection } from '@/state/connections';
import { cachedMessageCount, clearCachedMessages, setSetting } from '@/state/db';
import { encodeBool, useSettings, type PollScale, type Settings } from '@/state/settings';
import { useTheme, type ThemePreference } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, screenPadding, spacing } from '@/theme/tokens';

/**
 * Settings.
 *
 * Deliberately short. Everything that could live here and doesn't is either a
 * per-host setting (which belongs on the host) or a preference the system
 * already owns.
 */
export default function SettingsScreen() {
  const db = useSQLiteContext();
  const settings = useSettings();
  const connection = useSelectedConnection();
  const connections = useConnections((state) => state.connections);

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
          labelInset={ROW_INSET}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          value={settings.themePreference}
          onChange={(next) => update('themePreference', next)}
        />

        {/* Framed as how often it checks, not as a number of seconds: the two
            screens poll at different rates on purpose — the open conversation is
            more urgent than the list behind it — and exposing raw seconds would
            mean either flattening that or shipping two settings nobody wants to
            reason about. */}
        <SegmentedField<PollScale>
          label="Check for updates"
          labelInset={ROW_INSET}
          options={[
            { value: 1, label: 'Often' },
            { value: 2, label: 'Less' },
            { value: 5, label: 'Rarely' },
          ]}
          value={settings.pollScale}
          onChange={(next) => update('pollScale', next)}
        />
        <Text
          variant="caption"
          color="secondary"
          style={{ paddingHorizontal: ROW_INSET, marginTop: -spacing.md }}>
          Every check is a round-trip over SSH. Slower saves battery and data on
          cellular; the live message stream is unaffected either way.
        </Text>

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
            <View
              style={{
                paddingHorizontal: ROW_INSET,
                paddingTop: spacing.xs,
                paddingBottom: spacing.xs,
                gap: spacing.xs,
              }}>
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
          <Row label="Cached messages" value={cached === null ? '—' : cached.toLocaleString()} />
          <Divider />
          {/* The button is a row too, so its edges line up with the label above
              rather than being the one element in the group that runs wider. */}
          <View style={{ paddingHorizontal: ROW_INSET, paddingVertical: spacing.sm }}>
            <Button
              title="Clear cache"
              variant="tinted"
              onPress={confirmClearCache}
              disabled={cached === 0}
              testID="clear-cache"
            />
          </View>
        </Section>

        {/* Version and build, and nothing else.

            This section used to also report Liquid Glass availability, the New
            Architecture, Reduce Motion and Reduce Transparency. Every one of
            those is a fact about the build or a mirror of a switch in iOS
            Settings — worth checking while developing, and noise on the screen a
            person actually opens. The two rows left are the two you quote when
            something is wrong. */}
        <Section title="About">
          <Row label="Version" value={Constants.expoConfig?.version ?? '—'} />
          <Divider />
          <Row label="Build" value={String(Constants.expoConfig?.ios?.buildNumber ?? '—')} />
        </Section>

        <Text variant="caption" color="secondary" style={{ paddingHorizontal: ROW_INSET }}>
          HerdrChat reaches your machines over SSH on your tailnet. Keys are stored in the device
          keychain and never leave it; nothing is sent to any server of ours, because there isn’t
          one.
        </Text>
      </ScrollView>
    </Screen>
  );
}

/**
 * A titled group of rows.
 *
 * The card carries no horizontal padding of its own — every row supplies
 * `ROW_INSET` instead, and so does the title. That is the whole alignment fix:
 * previously the card was padded and the title was not, so a heading sat 12pt to
 * the left of the labels it introduced. One inset, applied at the row level,
 * also lets a divider stop short of the label's left edge the way a system list
 * does, instead of cutting the full width of the card.
 */
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
      <Text variant="footnote" color="secondary" style={{ paddingHorizontal: ROW_INSET }}>
        {title}
      </Text>
      <View
        style={{
          borderRadius: radius.sm,
          backgroundColor: colors.secondarySystemBackground,
          // A hairline rim. The light scheme's card sits only a shade off its
          // canvas — enough separation to group, not enough to give the card an
          // edge — and without this it reads as a smudge rather than a surface.
          borderWidth: 1,
          borderColor: colors.separator,
          // Matches a row's own vertical padding, so the space above the first
          // row equals the space between any two.
          paddingVertical: spacing.sm,
          overflow: 'hidden',
        }}>
        {children}
      </View>
      {footer !== undefined && (
        <Text variant="caption" color="secondary" style={{ paddingHorizontal: ROW_INSET }}>
          {footer}
        </Text>
      )}
    </View>
  );
}

/**
 * The horizontal inset shared by every row, every section title and every
 * footer. Section cards do not pad; their contents do.
 */
const ROW_INSET = spacing.md;

/**
 * The rule between two rows, inset to the label's left edge.
 *
 * `marginVertical` matters as much as the line: rows pad themselves by
 * `spacing.sm` top and bottom, so a divider drawn flush would sit 8pt from the
 * text above and 8pt from the text below with no air of its own.
 */
function Divider() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        height: 1,
        marginLeft: ROW_INSET,
        marginVertical: spacing.xxs,
        backgroundColor: colors.separator,
      }}
    />
  );
}

/**
 * A label and its value. Same inset, same vertical padding and same type size as
 * `Toggle`, because a reader scanning down a settings screen sees one column of
 * rows — not a switch list and, further down, a slightly smaller info list.
 */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        paddingHorizontal: ROW_INSET,
        paddingVertical: spacing.sm,
        minHeight: minTouchTarget,
      }}>
      <Text variant="body">{label}</Text>
      <Text variant="body" color="secondary" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}
