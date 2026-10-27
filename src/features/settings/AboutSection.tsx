import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Platform } from 'react-native';

import { confirmDestructive } from '@/components/ActionSheet';
import { ActionRow, Divider, Row, Section } from '@/components/SettingsList';
import { errorText } from '@/lib/herdr/protocol';
import { versionAdvice, versionVerdict } from '@/lib/herdr/version';
import { clientFor, useSelectedConnection } from '@/state/connections';
import { hostVersionOf, useHostVersion } from '@/state/hostVersion';

const PRIVACY_URL = 'https://herdrchat.cobanov.dev/privacy';
const TERMS_URL = 'https://herdrchat.cobanov.dev/terms';

/**
 * Version, build, and the two legal pages.
 *
 * This section used to also report Liquid Glass availability, the New
 * Architecture, Reduce Motion and Reduce Transparency. Every one of those is a
 * fact about the build or a mirror of a switch in iOS Settings — worth checking
 * while developing, and noise on the screen a person actually opens. They now
 * live inside Copy diagnostics, where they are read by whoever needs them and
 * nobody else.
 *
 * The two rows that remain are the two you quote when something is wrong, and
 * they sit next to the links the app stores require. Opening in the browser
 * rather than in-app on purpose: a bundled copy is a second version of the text
 * that has to be kept in step with the site, and legal pages are exactly where
 * two versions drifting apart is worst.
 */
export function AboutSection() {
  const version = Constants.expoConfig?.version ?? '—';
  const build =
    Platform.OS === 'ios'
      ? String(Constants.expoConfig?.ios?.buildNumber ?? '—')
      : String(Constants.expoConfig?.android?.versionCode ?? '—');

  /**
   * The HOST's herdr, which is a different number from ours and the one that
   * actually explains behaviour. "Sending feels slow" and "the agent never
   * reports a session" both have herdr-version answers, and until now neither
   * the user nor a bug report carried the version to find them with.
   */
  const connection = useSelectedConnection();
  const hostVersion = useHostVersion((state) => hostVersionOf(state.versions, connection?.id));
  const verdict = versionVerdict(hostVersion);
  /**
   * No advice until there is a host AND it has answered.
   *
   * `unknown` covers two different situations and only one of them is worth a
   * sentence: a host that replied without a version field, versus no host at all
   * or no poll landed yet. Showing "this host didn't report its version" on a
   * screen with no hosts configured is telling someone about a machine that does
   * not exist.
   */
  const advice =
    connection === null || hostVersion === null ? null : versionAdvice(verdict);
  const [updating, setUpdating] = useState(false);
  /** What the last Update herdr came to, when that is worth saying: a failure, or a server left behind. */
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  const updatable =
    connection !== null && (verdict.kind === 'outdated' || verdict.kind === 'legacy' || verdict.kind === 'unsupported');

  /**
   * Updates herdr where the agents run, asked first: it downloads and runs a
   * new herdr there, and hands the running server over to it, which herdr
   * still calls experimental. The version read after it lands in the store the
   * chat list fills, which is what turns the warning off.
   */
  const update = () => {
    if (connection === null) return;
    confirmDestructive({
      title: 'Update herdr on this host?',
      message: `This runs herdr update --handoff on ${connection.host}: it installs the latest herdr and hands the running server over to it, so agents keep running. herdr calls the handoff experimental.`,
      confirmLabel: 'Update now',
      onConfirm: () => {
        setUpdating(true);
        setUpdateNote(null);
        void clientFor(connection)
          .updateHerdr()
          .then((version) => {
            useHostVersion.getState().setVersion(connection.id, version);
            if (version === hostVersion) {
              setUpdateNote(`herdr’s server still runs ${version ?? 'the old version'}: it could not be handed over to a newer herdr. Restart herdr on the host to finish.`);
            }
          })
          .catch((thrown: unknown) => setUpdateNote(errorText(thrown)))
          .finally(() => setUpdating(false));
      },
    });
  };

  return (
    <Section title="About" footer={updateNote ?? advice ?? undefined}>
      <Row label="Version" value={version} />
      <Divider />
      <Row label="Build" value={build} />
      <Divider />
      <Row
        label="herdr on host"
        value={
          connection === null
            ? 'no host'
            : hostVersion === null
              ? '—'
              : verdict.kind === 'unknown'
                ? 'not reported'
                : `${verdict.version}${verdict.kind === 'current' ? '' : ' ⚠︎'}`
        }
      />
      <Divider />
      {updatable && (
        <>
          <ActionRow
            label={updating ? 'Updating herdr…' : 'Update herdr'}
            tone="tint"
            accessory="none"
            disabled={updating}
            onPress={update}
            testID="update-herdr"
          />
          <Divider />
        </>
      )}
      <ActionRow
        label="Privacy Policy"
        accessory="external"
        onPress={() => void Linking.openURL(PRIVACY_URL)}
        testID="legal-privacy"
      />
      <Divider />
      <ActionRow
        label="Terms of Service"
        accessory="external"
        onPress={() => void Linking.openURL(TERMS_URL)}
        testID="legal-terms"
      />
    </Section>
  );
}
