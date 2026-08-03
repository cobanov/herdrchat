import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';

import { connect, exec, streamLines, type SshConfig } from '../modules/herdr-ssh/src';
import { runtimeReport } from '@/lib/runtimeReport';
import { shellQuote, withPath } from '@/lib/herdr/shell';

/**
 * Temporary build-spine + SSH probe.
 *
 * The whole rewrite rests on two things being true, and neither may be assumed:
 * that the New Architecture is actually on, and that the hand-written SSH
 * TurboModule really talks to a host. This screen answers both from the running
 * app. It self-runs on mount so it can be verified headlessly, and it is
 * replaced by the chat list in phase 6.
 *
 * Credentials come from EXPO_PUBLIC_DEV_SSH_* in a gitignored .env.local, so no
 * private key ever lands in a committed file.
 */
export default function Probe() {
  const report = runtimeReport();
  const [log, setLog] = useState<string[]>([]);
  const [tailLines, setTailLines] = useState<string[]>([]);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const say = (line: string) => setLog((previous) => [...previous, line]);
    const host = process.env.EXPO_PUBLIC_DEV_SSH_HOST ?? '';
    const username = process.env.EXPO_PUBLIC_DEV_SSH_USER ?? '';
    const tailPath = process.env.EXPO_PUBLIC_DEV_SSH_TAIL ?? '';
    const config: SshConfig = {
      host,
      port: Number(process.env.EXPO_PUBLIC_DEV_SSH_PORT ?? '22') || 22,
      username,
      auth: {
        kind: 'privateKey',
        // A PEM is multi-line and a dotenv value is not, so .env.local stores it
        // with escaped newlines and they are restored here.
        pem: (process.env.EXPO_PUBLIC_DEV_SSH_KEY ?? '').replaceAll('\\n', '\n'),
      },
      hostKeyFingerprint: null,
    };

    let cancelled = false;

    const run = async () => {
      if (!host || !username) {
        say('no EXPO_PUBLIC_DEV_SSH_* config — skipping SSH probe');
        return;
      }

      say(`connect ${username}@${host}:${config.port}`);
      const connected = await connect('probe', config);
      if (!connected.ok) {
        say(`FAILED ${connected.code}: ${connected.message}`);
        return;
      }
      say(`OK pinned ${connected.fingerprint.slice(0, 24)}…`);

      for (const command of ['uname -sm', 'herdr status server']) {
        const result = await exec('probe', withPath(command));
        if (!result.ok) {
          say(`${command} -> FAILED ${result.code}`);
          continue;
        }
        const body = (result.stdout || result.stderr).trim().split('\n')[0] ?? '';
        say(`${command} -> exit ${result.exitCode} ${body.slice(0, 60)}`);
      }

      // Reconnect with the fingerprint we just pinned, then present a WRONG one:
      // TOFU is only worth having if the mismatch path actually refuses.
      const wrongPin = await connect('pin-check', {
        ...config,
        hostKeyFingerprint: 'AAAAdefinitelyNotThisHostsKeyAAAAAAAAAAAAAA=',
      });
      say(
        wrongPin.ok
          ? 'pin check -> ACCEPTED A BAD KEY (bug)'
          : `pin check -> refused (${wrongPin.code})`
      );

      if (!tailPath) return;
      say(`tail -f ${tailPath}`);
      try {
        for await (const line of streamLines(
          'probe',
          withPath(`tail -n +1 -f ${shellQuote(tailPath)}`)
        )) {
          if (cancelled) break;
          setTailLines((previous) => [...previous.slice(-6), line]);
        }
      } catch (error) {
        say(`tail FAILED: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>HerdrChat</Text>
      <Text style={styles.subtitle}>build spine + ssh probe</Text>

      <Row label="Platform" value={`${Platform.OS} ${String(Platform.Version)}`} />
      <Row label="Fabric (New Arch)" value={yesNo(report.fabric)} />
      <Row label="Bridgeless" value={yesNo(report.bridgeless)} />
      <Row label="Hermes" value={yesNo(report.hermes)} />
      <Row label="TurboModules" value={yesNo(report.turboModules)} />
      <Row label="Liquid Glass" value={yesNo(isLiquidGlassAvailable())} />
      <Row label="Glass effect API" value={yesNo(isGlassEffectAPIAvailable())} />

      <Text style={styles.section}>SSH</Text>
      <View style={styles.logBox} testID="ssh-log">
        {log.map((line, index) => (
          <Text key={index} style={styles.mono}>
            {line}
          </Text>
        ))}
      </View>

      <Text style={styles.section}>tail ({tailLines.length} shown)</Text>
      <View style={styles.logBox} testID="ssh-tail">
        {tailLines.map((line, index) => (
          <Text key={index} style={styles.mono} numberOfLines={1}>
            ⟩ {line}
          </Text>
        ))}
      </View>
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
  content: { padding: 20, gap: 2, paddingBottom: 60 },
  title: { fontSize: 30, fontWeight: '700' },
  subtitle: { fontSize: 14, opacity: 0.6, marginBottom: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  rowLabel: { fontSize: 15 },
  rowValue: { fontSize: 15, fontWeight: '600' },
  section: { fontSize: 13, fontWeight: '700', marginTop: 18, marginBottom: 4, opacity: 0.5 },
  logBox: { gap: 3 },
  mono: { fontFamily: 'Menlo', fontSize: 11 },
});
