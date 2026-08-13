import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { confirmDestructive } from '@/components/ActionSheet';
import { Button } from '@/components/Button';
import { Field, SegmentedField } from '@/components/Field';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { HerdrError } from '@/lib/herdr/protocol';
import { formatFingerprint, shouldResetPin } from '@/lib/hostkey';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, spacing } from '@/theme/tokens';
import {
  clearSecrets,
  invalidateClient,
  loadHostKeyPin,
  loadSecret,
  saveHostKeyPin,
  saveSecret,
  testClient,
  useConnections,
  type ServerConnection,
} from '@/state/connections';
import { saveConnection, setSetting } from '@/state/db';
import { SELECTED_KEY } from '@/state/Hydrate';

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok' }
  | { kind: 'failed'; message: string; herdrMissing: boolean }
  /**
   * The host answered with a key that differs from the stored pin. Its own
   * state, not a `failed` flavour: the only way forward is an explicit,
   * confirmed decision to trust the new key — never a silent re-pin.
   */
  | { kind: 'keyChanged'; message: string };

/**
 * Add or edit a herdr host.
 *
 * A connection must pass a LIVE test before it can be saved. That is not
 * ceremony: a saved-but-broken server produces a chat list that fails to load
 * with no obvious cause, and the fix (a typo'd host, the wrong user, herdr not
 * installed) is only discoverable by actually trying.
 */
export default function ServerEditScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id: string; mode?: string }>();
  const connections = useConnections((state) => state.connections);
  const upsert = useConnections((state) => state.upsert);

  const existing = connections.find((connection) => connection.id === params.id) ?? null;
  const isNew = existing === null;

  const [name, setName] = useState(existing?.name ?? '');
  const [host, setHost] = useState(existing?.host ?? '');
  const [port, setPort] = useState(String(existing?.port ?? 22));
  const [username, setUsername] = useState(existing?.username ?? '');
  const [authKind, setAuthKind] = useState<ServerConnection['authKind']>(
    existing?.authKind ?? 'privateKey'
  );
  const [secret, setSecret] = useState('');
  const [herdrPath, setHerdrPath] = useState(existing?.herdrPath ?? 'herdr');
  const [sessionName, setSessionName] = useState(existing?.sessionName ?? '');
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  // What the passing test's connection actually accepted; save() persists it
  // when the endpoint changed, so the pin is always a key we presented
  // credentials to — never whoever answers the next connect.
  const [observedFingerprint, setObservedFingerprint] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  // The pin this host is already bound to, for the reader to compare against
  // `ssh-keygen -lf` on the machine itself. Read once: it only changes through
  // the flows on this screen, which set `observedFingerprint` anyway.
  const [storedPin, setStoredPin] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void loadHostKeyPin(params.id).then((pin) => {
      if (alive) setStoredPin(pin);
    });
    return () => {
      alive = false;
    };
  }, [params.id]);
  // What a test just saw wins over what was stored: on a re-key the two differ,
  // and the interesting one is the key on the wire now.
  const fingerprint = observedFingerprint ?? storedPin;

  const valid =
    name.trim().length > 0 &&
    host.trim().length > 0 &&
    username.trim().length > 0 &&
    Number.isFinite(Number(port));

  // Any change to a connection-relevant field invalidates a prior pass.
  const invalidate = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setTest({ kind: 'idle' });
  };

  const draft = (): ServerConnection => ({
    id: params.id,
    name: name.trim(),
    host: host.trim(),
    port: Number(port) || 22,
    username: username.trim(),
    authKind,
    herdrPath: herdrPath.trim().length === 0 ? 'herdr' : herdrPath.trim(),
    sessionName: sessionName.trim(),
  });

  const resolveSecret = async (): Promise<string> => {
    if (secret.length > 0) return secret;
    // Editing with the field left blank keeps the stored secret.
    return (await loadSecret(params.id)) ?? '';
  };

  const runTest = async () => {
    setTest({ kind: 'testing' });
    setObservedFingerprint(null);
    const connection = draft();
    const { client, dispose } = testClient(connection, await resolveSecret(), connection.herdrPath, {
      // An unchanged endpoint keeps its identity: the test must refuse any key
      // but the pinned one, because it authenticates with real credentials.
      enforceStoredPin: !shouldResetPin(existing, connection),
      onFingerprint: setObservedFingerprint,
    });
    try {
      await client.ping();
      setTest({ kind: 'ok' });
    } catch (thrown) {
      const failure = thrown instanceof HerdrError ? thrown : null;
      if (failure?.code === 'host_key_changed') {
        setTest({ kind: 'keyChanged', message: failure.message });
      } else {
        setTest({
          kind: 'failed',
          message: failure?.message ?? (thrown instanceof Error ? thrown.message : String(thrown)),
          herdrMissing: failure?.code === 'herdr_not_found',
        });
      }
    } finally {
      await dispose();
    }
  };

  const trustNewKey = () => {
    confirmDestructive({
      title: 'Trust the new key?',
      message:
        'This forgets the key this host was pinned to. Do this only if you reinstalled or re-keyed the server yourself.',
      confirmLabel: 'Trust the new key',
      onConfirm: () => {
        void (async () => {
          await clearSecrets(params.id, { keepSecret: true });
          await runTest();
        })();
      },
    });
  };

  /**
   * The same rule as the chat list's banner: a remote script piped into a shell
   * is stated in full and confirmed before it runs, never one tap.
   *
   * Note what the test transport does and does not promise here. An edit that
   * leaves host and port alone enforces the stored pin, so the installer runs on
   * the machine this host was already pinned to. On a NEW host there is no pin
   * to enforce — first contact is trust-on-first-use by nature, and confirming
   * the command is the only check there is.
   */
  const confirmInstallHerdr = () => {
    const connection = draft();
    confirmDestructive({
      title: 'Run the herdr installer?',
      message: `This runs curl -fsSL https://herdr.dev/install.sh | sh on ${connection.host} as ${connection.username}. It downloads a script from herdr.dev and runs it there.`,
      confirmLabel: 'Run the installer',
      onConfirm: () => void installHerdr(),
    });
  };

  const installHerdr = async () => {
    setInstalling(true);
    const connection = draft();
    const { client, dispose } = testClient(connection, await resolveSecret(), connection.herdrPath, {
      enforceStoredPin: !shouldResetPin(existing, connection),
      onFingerprint: setObservedFingerprint,
    });
    try {
      await client.installHerdr();
      await dispose();
      setInstalling(false);
      await runTest();
    } catch (thrown) {
      await dispose();
      setInstalling(false);
      setTest({
        kind: 'failed',
        message: thrown instanceof HerdrError ? thrown.message : String(thrown),
        herdrMissing: false,
      });
    }
  };

  const save = async () => {
    const connection = draft();
    if (secret.length > 0) await saveSecret(connection.id, secret);
    // The pin survives a cosmetic edit (name, herdr path, session). Only a
    // changed endpoint replaces it — and then with the key the passing test
    // actually saw, never a blank slate the next connect fills in blindly.
    if (shouldResetPin(existing, connection) && observedFingerprint !== null) {
      await saveHostKeyPin(connection.id, observedFingerprint);
    }
    await invalidateClient(connection.id);
    await saveConnection(db, connection);
    await setSetting(db, SELECTED_KEY, connection.id);
    upsert(connection);
    router.dismissAll();
  };

  return (
    <Screen presentation="sheet">
      <Header title={isNew ? 'New host' : 'Edit host'} onClose={() => router.back()} />

      <ScrollView
        contentContainerStyle={{ padding: screenPadding, gap: spacing.lg, paddingBottom: spacing.xxxl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        // Without this the keyboard covers the submit button at the end of the
        // form, which is the one control the whole screen exists to reach.
        automaticallyAdjustKeyboardInsets>
        <View style={{ gap: spacing.sm }}>
          <Field label="Name" placeholder="nuc" value={name} onChangeText={invalidate(setName)} testID="field-name" />
          <Field
            label="Host"
            placeholder="100.x.y.z or a Tailscale name"
            value={host}
            onChangeText={invalidate(setHost)}
            autoCapitalize="none"
            testID="field-host"
          />
          <Field
            label="Port"
            value={port}
            onChangeText={invalidate(setPort)}
            keyboardType="number-pad"
            testID="field-port"
          />
          <Field
            label="Username"
            value={username}
            onChangeText={invalidate(setUsername)}
            autoCapitalize="none"
            testID="field-username"
          />
        </View>

        <View style={{ gap: spacing.sm }}>
          <SegmentedField
            label="Authentication"
            options={[
              { value: 'privateKey', label: 'Private key' },
              { value: 'password', label: 'Password' },
            ]}
            value={authKind}
            onChange={invalidate(setAuthKind)}
          />
          {authKind === 'privateKey' ? (
            <Field
              label="OpenSSH private key"
              placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n…'}
              value={secret}
              onChangeText={invalidate(setSecret)}
              multiline
              mono
              autoCapitalize="none"
              testID="field-secret"
            />
          ) : (
            <Field
              label="Password"
              value={secret}
              onChangeText={invalidate(setSecret)}
              secureTextEntry
              autoCapitalize="none"
              testID="field-secret"
            />
          )}
          <Text variant="caption" color="secondary">
            {isNew
              ? 'Stored in the device keychain, never in the database.'
              : 'Leave empty to keep the current secret.'}
          </Text>
        </View>

        <Field
          label="herdr path"
          value={herdrPath}
          onChangeText={invalidate(setHerdrPath)}
          autoCapitalize="none"
          testID="field-herdr-path"
        />

        {/* Blank is the common case and the right default. Naming a session only
            matters on a host running more than one, where we previously drove
            whichever the default resolved to without saying so. */}
        <View style={{ gap: spacing.xs }}>
          <Field
            label="herdr session"
            placeholder="Default"
            value={sessionName}
            onChangeText={invalidate(setSessionName)}
            autoCapitalize="none"
            testID="field-session"
          />
          <Text variant="caption" color="secondary">
            Leave empty unless this machine runs more than one herdr session. The
            name is what `herdr session list` shows.
          </Text>
        </View>

        <View style={{ gap: spacing.md }}>
          <Button
            title={test.kind === 'testing' ? 'Testing…' : 'Test connection'}
            variant="tinted"
            loading={test.kind === 'testing'}
            disabled={!valid}
            onPress={() => void runTest()}
            testID="test-connection"
          />

          {test.kind === 'ok' && (
            <View
              style={{
                padding: spacing.md,
                borderRadius: radius.sm,
                backgroundColor: colors.tintMuted,
              }}>
              <Text variant="subhead" color="tint" weight="600" testID="test-ok">
                Connected — herdr is answering.
              </Text>
            </View>
          )}

          {test.kind === 'failed' && (
            <View
              style={{
                padding: spacing.md,
                borderRadius: radius.sm,
                backgroundColor: colors.fillSubtle,
                gap: spacing.sm,
              }}>
              <Text variant="subhead" weight="600">
                Couldn’t connect
              </Text>
              <Text variant="footnote" color="secondary">
                {test.message}
              </Text>
              {test.herdrMissing && (
                <Button
                  title={installing ? 'Installing…' : 'Install herdr on the host'}
                  variant="tinted"
                  loading={installing}
                  onPress={confirmInstallHerdr}
                />
              )}
            </View>
          )}

          {test.kind === 'keyChanged' && (
            <View
              style={{
                padding: spacing.md,
                borderRadius: radius.sm,
                backgroundColor: colors.fillSubtle,
                gap: spacing.sm,
              }}>
              <Text variant="subhead" weight="600" testID="test-key-changed">
                The host identifies with a different key
              </Text>
              <Text variant="footnote" color="secondary">
                {test.message}
              </Text>
              <Text variant="footnote" color="secondary">
                If you did not reinstall or re-key this server, stop here — something
                between you and it could be intercepting the connection.
              </Text>
              <Button title="Trust the new key" variant="tinted" onPress={trustNewKey} />
            </View>
          )}

          {/* Shown once there is something true to show: a key a test just
              accepted, or the pin this host is already bound to. Selectable and
              monospaced because its only real use is being compared, character
              by character, with `ssh-keygen -lf` on the machine. */}
          {fingerprint !== null && (
            <View style={{ gap: spacing.xs }}>
              <Text variant="caption" color="secondary">
                Host key fingerprint
              </Text>
              <Text variant="caption" color="tertiary" mono selectable testID="host-fingerprint">
                {formatFingerprint(fingerprint)}
              </Text>
            </View>
          )}

          <Button
            title="Save"
            onPress={() => void save()}
            disabled={test.kind !== 'ok'}
            testID="save-server"
          />
          {test.kind !== 'ok' && (
            <Text variant="caption" color="secondary" style={{ textAlign: 'center' }}>
              Test the connection before saving, so a typo doesn’t become a chat list that
              silently fails to load.
            </Text>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
