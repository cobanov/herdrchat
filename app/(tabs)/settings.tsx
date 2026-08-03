import Constants from 'expo-constants';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Header } from '@/components/Header';
import { SegmentedField } from '@/components/Field';
import { Text } from '@/components/Text';
import { useGlassAvailable } from '@/components/Glass';
import { useTheme, useThemePreference, type ThemePreference } from '@/theme/ThemeProvider';
import { radius, screenPadding, spacing } from '@/theme/tokens';

/**
 * Settings.
 *
 * Deliberately short: everything that could live here and doesn't is either a
 * per-server setting (which belongs on the server) or a preference the system
 * already owns. The appearance override exists because "follow the system" is
 * not always what someone wants from a chat app they read in bed.
 */
export default function SettingsScreen() {
  const { colors, reduceMotion, reduceTransparency } = useTheme();
  const { preference, setPreference } = useThemePreference();
  const glass = useGlassAvailable();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.systemBackground }} edges={['top']}>
      <Header title="Settings" />

      <ScrollView
        contentContainerStyle={{ padding: screenPadding, gap: spacing.xl, paddingBottom: spacing.xxxl }}>
        <SegmentedField<ThemePreference>
          label="Appearance"
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          value={preference}
          onChange={setPreference}
        />

        <View style={{ gap: spacing.sm }}>
          <Text variant="footnote" color="secondary">
            About
          </Text>
          <View
            style={{
              borderRadius: radius.sm,
              backgroundColor: colors.secondarySystemBackground,
              padding: spacing.md,
              gap: spacing.sm,
            }}>
            <Row label="Version" value={Constants.expoConfig?.version ?? '—'} />
            <Row
              label="Build"
              value={String(Constants.expoConfig?.ios?.buildNumber ?? '—')}
            />
            {/* Surfaced rather than hidden: whether the OS actually granted the
                glass API is the difference between the design people were shown
                and the one they got, and it varies by build. */}
            <Row label="Liquid Glass" value={glass ? 'on' : 'unavailable'} />
            <Row label="Reduce Motion" value={reduceMotion ? 'on' : 'off'} />
            <Row label="Reduce Transparency" value={reduceTransparency ? 'on' : 'off'} />
          </View>
        </View>

        <Text variant="caption" color="secondary">
          HerdrChat reaches your machines over SSH on your tailnet. Keys are stored in the device
          keychain and never leave it; nothing is sent to any server of ours, because there isn’t
          one.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
      <Text variant="subhead" color="secondary">
        {label}
      </Text>
      <Text variant="subhead">{value}</Text>
    </View>
  );
}
