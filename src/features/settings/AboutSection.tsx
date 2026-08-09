import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import { ActionRow, Divider, Row, Section } from '@/components/SettingsList';

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

  return (
    <Section title="About">
      <Row label="Version" value={version} />
      <Divider />
      <Row label="Build" value={build} />
      <Divider />
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
