import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { useState } from 'react';

import { useGlassAvailable } from '@/components/Glass';
import { ActionRow, Divider, Section } from '@/components/SettingsList';
import { haptics } from '@/lib/haptics';
import { runtimeReport } from '@/lib/runtimeReport';
import { clientFor, useConnections, useSelectedConnection } from '@/state/connections';
import { useHostVersion } from '@/state/hostVersion';
import { explainTarget, formatDiagnostics, summarizeAgentExplain } from './diagnostics';

/** Where a bug report goes. The same tracker the site already links to. */
const ISSUES_URL = 'https://github.com/cobanov/herdrchat/issues';
const README_URL = 'https://github.com/cobanov/herdrchat#readme';

/**
 * How long Copy diagnostics will wait on the host before pasting without
 * herdr's verdict.
 *
 * Asking for it costs two round-trips at the poll timeout each — up to thirty
 * seconds of a row that gives no haptic, no label change and no clipboard, on
 * exactly the phone most likely to be off the tailnet. The block is worth
 * pasting without that one line, so the wait is bounded and the line is simply
 * absent when the host is slow or away.
 */
const EXPLAIN_BUDGET_MS = 3000;

/**
 * Support, and the facts a support conversation needs.
 *
 * The tracker rather than an email address: every issue this app has ever had is
 * already there, it costs nothing to run, and a public thread is findable by the
 * next person with the same problem.
 *
 * Copy diagnostics exists because the alternative is asking. A report that
 * arrives without a version and a platform costs a round-trip before anyone can
 * begin, and nobody assembles that list unprompted from a phone.
 */
export function SupportSection() {
  const hostCount = useConnections((state) => state.connections.length);
  const selected = useSelectedConnection();
  const glassAvailable = useGlassAvailable();
  const [copied, setCopied] = useState(false);

  /**
   * herdr's account of one agent, or null.
   *
   * Best-effort on purpose: a person pressing this is already having a bad time,
   * and a phone that is off the tailnet must still produce a pasteable block.
   * Every failure — no host, no agent, no answer — is the same null.
   */
  const explainSelectedAgent = async (): Promise<string | null> => {
    if (selected === null) return null;
    try {
      const client = clientFor(selected);
      const target = explainTarget(await client.agents());
      return target === null ? null : await client.explainAgent(target);
    } catch {
      return null;
    }
  };

  /**
   * The verdict as one line, or null — bounded, summarised, and never a throw.
   * The raw JSON never reaches the clipboard; see `summarizeAgentExplain` for
   * what it carries and why none of it belongs in a public issue.
   */
  const agentVerdict = async (): Promise<string | null> => {
    const budget = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), EXPLAIN_BUDGET_MS);
    });
    return summarizeAgentExplain(await Promise.race([explainSelectedAgent(), budget]));
  };

  const copyDiagnostics = async () => {
    const agentExplain = await agentVerdict();
    const report = runtimeReport();
    const text = formatDiagnostics({
      version: Constants.expoConfig?.version ?? 'unknown',
      build: String(
        Platform.OS === 'ios'
          ? Constants.expoConfig?.ios?.buildNumber ?? 'unknown'
          : Constants.expoConfig?.android?.versionCode ?? 'unknown'
      ),
      platform: Platform.OS === 'ios' ? 'iOS' : 'Android',
      osVersion: String(Platform.Version),
      hostCount,
      newArchitecture: report.fabric && report.bridgeless,
      glassAvailable,
      // Null until something owns "the last thing that went wrong". Errors are
      // currently held per-screen and cleared when their banner is dismissed, so
      // reading one here would report whatever screen happened to fail last —
      // and a stale error in a bug report is worse than no error at all.
      lastError: null,
      herdrVersion: useHostVersion.getState().version,
      agentExplain,
    });
    void Clipboard.setStringAsync(text);
    haptics.success();
    setCopied(true);
  };

  return (
    <Section
      title="Support"
      footer="Diagnostics carry your app version, platform and how many hosts you have configured — never their names, addresses or keys.">
      <ActionRow
        label="Report a problem"
        detail="Opens the issue tracker on GitHub."
        accessory="external"
        onPress={() => void Linking.openURL(ISSUES_URL)}
        testID="support-issues"
      />
      <Divider />
      <ActionRow
        label="How HerdrChat works"
        detail="Setup, the host watcher, and what runs where."
        accessory="external"
        onPress={() => void Linking.openURL(README_URL)}
        testID="support-docs"
      />
      <Divider />
      <ActionRow
        label={copied ? 'Copied' : 'Copy diagnostics'}
        detail={
          copied
            ? 'Paste it into your report.'
            : 'Version, build and platform, for a bug report.'
        }
        tone="tint"
        accessory="none"
        onPress={() => void copyDiagnostics()}
        testID="support-diagnostics"
      />
    </Section>
  );
}
