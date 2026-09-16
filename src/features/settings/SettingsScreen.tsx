import { useSQLiteContext } from 'expo-sqlite';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AdaptiveColumns, useTabletLayout } from '@/components/AdaptiveColumns';
import { SegmentedField } from '@/components/Field';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Divider, ROW_INSET, Row, Section } from '@/components/SettingsList';
import { Text } from '@/components/Text';
import { Toggle } from '@/components/Toggle';
import { AboutSection } from '@/features/settings/AboutSection';
import { DangerZone } from '@/features/settings/DangerZone';
import { HighlightOnLink, isSettingsSection, SETTINGS_SECTIONS, type SettingsSection } from './HighlightOnLink';
import { HostCard } from '@/features/settings/HostCard';
import { ConnectionCheck } from '@/features/settings/ConnectionCheck';
import { useSelectedConnection } from '@/state/connections';
import { NotificationsSection } from '@/features/settings/NotificationsSection';
import { SupportSection } from '@/features/settings/SupportSection';
import { useLinkedSection } from '@/features/settings/useLinkedSection';
import { useTabPressHaptic } from '@/features/useTabPressHaptic';
import { cachedMessageCount, setSetting } from '@/state/db';
import { encodeBool, useSettings, type PollScale, type Settings } from '@/state/settings';
import { useTheme, type ThemePreference } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, screenPadding, size, spacing } from '@/theme/tokens';

const SECTION_TITLES: Record<SettingsSection, string> = {
  connection: 'Connection', appearance: 'Appearance', conversations: 'Conversations',
  notifications: 'Notifications', storage: 'Storage', support: 'Support', about: 'About', danger: 'Danger zone',
};

/**
 * Settings.
 *
 * Every group is a component in `features/settings`; this file decides only what
 * order they come in and handles arriving from a link. The screen used to be 375
 * lines of route, which is 275 more than a route should be.
 *
 * The order is deliberate: who you are talking to, then how the app looks, then
 * what it shows you, then how it reaches you, then the two things you go looking
 * for when something is wrong, and finally, alone, in red, the two you can't
 * take back.
 */
export default function SettingsScreen() {
  const wide = useTabletLayout();
  const router = useRouter();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const selected = isSettingsSection(section) ? section : 'connection';
  const show = (value: SettingsSection) => !wide || selected === value;
  const db = useSQLiteContext();
  const settings = useSettings();
  const connection = useSelectedConnection();
  const { colors } = useTheme();
  useTabPressHaptic();

  const [cached, setCached] = useState<number | null>(null);
  const refreshCacheSize = useCallback(() => {
    void cachedMessageCount(db).then(setCached);
  }, [db]);
  useEffect(refreshCacheSize, [refreshCacheSize]);

  /** Persist alongside the store, so the mirror never drifts from the source. */
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    settings.set(key, value);
    void setSetting(db, key, typeof value === 'boolean' ? encodeBool(value) : String(value));
  };

  const { target, scrollRef, onMeasure } = useLinkedSection();

  return (
    <AdaptiveColumns sidebar={
      <Screen>
        <Header title="Settings" />
        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.xs }}>
          {SETTINGS_SECTIONS.map((value) => (
            <Pressable
              key={value}
              testID={`settings-section-${value}`}
              accessibilityRole="button"
              accessibilityState={{ selected: value === selected }}
              onPress={() => router.setParams({ section: value })}
              style={({ pressed }) => ({
                padding: spacing.lg, minHeight: minTouchTarget, borderRadius: radius.sm,
                backgroundColor: value === selected ? colors.tintMuted : pressed ? colors.fillSubtle : 'transparent',
              })}>
              <Text variant="body" color={value === 'danger' ? 'destructive' : value === selected ? 'tint' : 'label'}>
                {SECTION_TITLES[value]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </Screen>
    }>
      <Screen>
        <Header title={wide ? SECTION_TITLES[selected] : 'Settings'} />

        <ScrollView
          key={wide ? selected : 'all'}
          ref={scrollRef}
          contentContainerStyle={{
            padding: screenPadding,
            gap: spacing.xl,
            paddingBottom: size.floatingBarClearance,
          }}>
          {/* The anchor. There is no account to show, the app signs in to nothing
             , so this answers the question an account header actually answers:
              which machine is all of this about. */}
          {show('connection') && <>
            <HostCard />
            {connection !== null && <ConnectionCheck key={connection.id} connection={connection} />}
          </>}

          {show('appearance') && <SegmentedField<ThemePreference>
            label="Appearance"
            labelInset={ROW_INSET}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            value={settings.themePreference}
            onChange={(next) => update('themePreference', next)}
          />}

          {show('conversations') && <><HighlightOnLink section="conversations" target={target} onMeasure={onMeasure}>
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
                detail="Feedback on sends, quick replies, swipes and toggles."
                value={settings.haptics}
                onChange={(next) => update('haptics', next)}
                testID="toggle-haptics"
              />
            </Section>
          </HighlightOnLink>

          {/* Framed as how often it checks, not as a number of seconds: the two
              screens poll at different rates on purpose, the open conversation is
              more urgent than the list behind it, and exposing raw seconds would
              mean either flattening that or shipping two settings nobody wants to
              reason about. */}
          <View style={{ gap: spacing.sm }}>
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
            <Text variant="caption" color="secondary" style={{ paddingHorizontal: ROW_INSET }}>
              Every check is a round-trip over SSH. Slower saves battery and data on
              cellular; the live message stream is unaffected either way.
            </Text>
          </View></>}

          {show('notifications') && <HighlightOnLink section="notifications" target={target} onMeasure={onMeasure}>
            <NotificationsSection />
          </HighlightOnLink>}

          {show('storage') && <Section title="Storage">
            <Row label="Cached messages" value={cached === null ? '-' : cached.toLocaleString()} />
          </Section>}

          {show('support') && <HighlightOnLink section="support" target={target} onMeasure={onMeasure}>
            <SupportSection />
          </HighlightOnLink>}

          {show('about') && <><AboutSection />

          <Text variant="caption" color="secondary" style={{ paddingHorizontal: ROW_INSET }}>
            HerdrChat reaches your machines over SSH on your tailnet. Keys are stored in the device
            keychain and never leave it; nothing is sent to any server of ours, because there isn’t
            one.
          </Text></>}

          {/* Last, alone, and separated by more than the usual gap. Nothing below
              it to scroll to, so nothing here is reached by accident. */}
          {show('danger') && <View style={{ marginTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.separator, paddingTop: spacing.xl }}>
            <HighlightOnLink section="danger" target={target} onMeasure={onMeasure}>
              <DangerZone onCacheCleared={refreshCacheSize} />
            </HighlightOnLink>
          </View>}
        </ScrollView>
      </Screen>
    </AdaptiveColumns>
  );
}
