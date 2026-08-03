import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';

import { runtimeReport } from '@/lib/runtimeReport';

/**
 * Temporary build-spine probe. This screen exists to answer, from the running
 * app rather than from a build log, the questions phase 1 must not assume:
 * is Fabric actually on, is the bridge really gone, and does this OS ship the
 * Liquid Glass API. It is replaced by the chat list in phase 6.
 */
export default function Probe() {
  const report = runtimeReport();

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>HerdrChat</Text>
      <Text style={styles.subtitle}>build spine probe</Text>

      <Row label="Platform" value={`${Platform.OS} ${String(Platform.Version)}`} />
      <Row label="Fabric (New Arch)" value={yesNo(report.fabric)} />
      <Row label="Bridgeless" value={yesNo(report.bridgeless)} />
      <Row label="Hermes" value={yesNo(report.hermes)} />
      <Row label="TurboModules" value={yesNo(report.turboModules)} />
      <Row label="Liquid Glass available" value={yesNo(isLiquidGlassAvailable())} />
      <Row label="Glass effect API" value={yesNo(isGlassEffectAPIAvailable())} />
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'NO';
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 4 },
  title: { fontSize: 34, fontWeight: '700' },
  subtitle: { fontSize: 15, opacity: 0.6, marginBottom: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  rowLabel: { fontSize: 17 },
  rowValue: { fontSize: 17, fontVariant: ['tabular-nums'], fontWeight: '600' },
});
