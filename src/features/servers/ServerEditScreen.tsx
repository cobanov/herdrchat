import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { confirmDestructive } from '@/components/ActionSheet';
import { Button } from '@/components/Button';
import { Field, SegmentedField } from '@/components/Field';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { HerdrError } from '@/lib/herdr/protocol';
import { connectionRecovery, type RecoveryAction } from '@/lib/connectionRecovery';
import { HostFingerprint, KeyChangedPanel } from '@/features/servers/HostKeyPanels';
import { shouldResetPin } from '@/lib/hostkey';
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
  | { kind: 'ok'; version: string | null }
  | { kind: 'failed'; message: string; code: string }
  /**
   * The host answered with a key that differs from the stored pin. Its own
   * state, not a `failed` flavour: the only way forward is an explicit,
   * confirmed decision to trust the new key, never a silent re-pin.
   */
  | { kind: 'keyChanged'; message: string; presented: string | null };

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
  const insets = useSafeAreaInsets();
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
    existing?.authKind ?? 'password'
  );
  const [secret, setSecret] = useState('');
  const [herdrPath, setHerdrPath] = useState(existing?.herdrPath ?? 'herdr');
  const [sessionName, setSessionName] = useState(existing?.sessionName ?? '');
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  // What the passing test's connection actually accepted; save() persists it
  // when the endpoint changed, so the pin is always a key we presented
  // credentials to, never whoever answers the next connect.
  const [observedFingerprint, setObservedFingerprint] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  // The pin this host is already bound to, for the reader to compare against
  // `ssh-keygen -lf` on the machine itself. Read once: it only changes through
  // the flows on this screen, which set `observedFingerprint` anyway.
  const [storedPin, setStoredPin] = useState<string | null>(null);
  const form = useRef<ScrollView>(null);
  const fieldOffsets = useRef({ address: 0, credentials: 0, path: 0 });
  const testAttempt = useRef(0);
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
    Number.isInteger(Number(port)) &&
    Number(port) > 0 &&
    Number(port) <= 65535;

  // Any change to a connection-relevant field invalidates a prior pass.
  const invalidate =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      testAttempt.current += 1;
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
    const attempt = ++testAttempt.current;
    setTest({ kind: 'testing' });
    setObservedFingerprint(null);
    const connection = draft();
    const { client, dispose } = testClient(
      connection,
      await resolveSecret(),
      connection.herdrPath,
      {
        // An unchanged endpoint keeps its identity: the test must refuse any key
        // but the pinned one, because it authenticates with real credentials.
        enforceStoredPin: !shouldResetPin(existing, connection),
        onFingerprint: setObservedFingerprint,
      }
    );
    try {
      await client.ping();
      const snapshot = await client.snapshot();
      if (attempt === testAttempt.current) setTest({ kind: 'ok', version: snapshot.version });
    } catch (thrown) {
      if (attempt !== testAttempt.current) return;
      const failure = thrown instanceof HerdrError ? thrown : null;
      if (failure?.code === 'host_key_changed') {
        setTest({ kind: 'keyChanged', message: failure.message, presented: failure.presentedFingerprint });
      } else {
        setTest({
          kind: 'failed',
          message: failure?.message ?? (thrown instanceof Error ? thrown.message : String(thrown)),
          code: failure?.code ?? 'unknown',
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
          const presented = test.kind === 'keyChanged' ? test.presented : null;
          if (presented !== null) {
            // Pin exactly the key that was shown. Clearing the pin and testing
            // again would trust whatever key answers next, which need not be
            // the one the user just compared.
            await saveHostKeyPin(params.id, presented);
            setStoredPin(presented);
            await runTest();
            return;
          }
          await clearSecrets(params.id, { keepSecret: true });
          // The screen's copy of the pin has to go with the stored one. `save()`
          // decides whether to write a pin by asking whether this host still has
          // one, and a stale value here answers yes to a host that no longer
          // does, which is how a re-trust ends up saving nothing.
          setStoredPin(null);
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
   * to enforce, first contact is trust-on-first-use by nature, and confirming
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
    const { client, dispose } = testClient(
      connection,
      await resolveSecret(),
      connection.herdrPath,
      {
        enforceStoredPin: !shouldResetPin(existing, connection),
        onFingerprint: setObservedFingerprint,
      }
    );
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
        code: thrown instanceof HerdrError ? thrown.code : 'unknown',
      });
    }
  };

  const recover = async (action: RecoveryAction) => {
    if (action === 'install') return confirmInstallHerdr();
    if (action === 'retry') return runTest();
    if (action !== 'start') {
      form.current?.scrollTo({
        y: fieldOffsets.current[action],
        animated: true,
      });
      return;
    }
    setInstalling(true);
    const connection = draft();
    const { client, dispose } = testClient(
      connection,
      await resolveSecret(),
      connection.herdrPath,
      {
        enforceStoredPin: !shouldResetPin(existing, connection),
        onFingerprint: setObservedFingerprint,
      }
    );
    try {
      await client.startServer();
      await runTest();
    } catch (thrown) {
      setTest({
        kind: 'failed',
        message: thrown instanceof Error ? thrown.message : String(thrown),
        code: thrown instanceof HerdrError ? thrown.code : 'unknown',
      });
    } finally {
      await dispose();
      setInstalling(false);
    }
  };

  const save = async () => {
    const connection = draft();
    if (secret.length > 0) await saveSecret(connection.id, secret);
    // The pin survives a cosmetic edit (name, herdr path, session). Only a
    // changed endpoint replaces it, and then with the key the passing test
    // actually saw, never a blank slate the next connect fills in blindly.
    //
    // A host with NO pin is the second case that must write one, and it is the
    // one "Trust the new key" produces: that flow deletes the pin and re-tests
    // against an endpoint it did not change, so the endpoint rule alone says
    // "keep what you have" about a host that now has nothing. Saving there left
    // the host unpinned and the next ordinary connect trusted whoever answered
    //, the exact blank slate the confirmation exists to prevent.
    if (
      observedFingerprint !== null &&
      (shouldResetPin(existing, connection) || storedPin === null)
    ) {
      await saveHostKeyPin(connection.id, observedFingerprint);
    }
    await invalidateClient(connection.id);
    await saveConnection(db, connection);
    await setSetting(db, SELECTED_KEY, connection.id);
    upsert(connection);
    router.dismissAll();
  };

  /**
   * Done used to drop a half-typed host without a word, key and all (#4
   * acceptance). With anything entered or changed it asks first.
   */
  const dirty = isNew
    ? [name, host, username, secret, sessionName].some((value) => value.trim().length > 0) ||
      herdrPath !== 'herdr' ||
      port !== '22'
    : name !== existing.name ||
      host !== existing.host ||
      port !== String(existing.port) ||
      username !== existing.username ||
      authKind !== existing.authKind ||
      secret.length > 0 ||
      herdrPath !== existing.herdrPath ||
      sessionName !== existing.sessionName;
  const close = () => {
    if (!dirty) {
      router.back();
      return;
    }
    confirmDestructive({
      title: isNew ? 'Discard this host?' : 'Discard your changes?',
      message: isNew ? 'What you entered here is not saved.' : 'The host keeps its saved settings.',
      confirmLabel: 'Discard',
      onConfirm: () => router.back(),
    });
  };

  return (
    <Screen presentation="sheet">
      <Header title={isNew ? 'New host' : 'Edit host'} onClose={close} />

      {/* iOS insets the form itself (automaticallyAdjustKeyboardInsets); Android
          has no such prop, and with edge-to-edge the window no longer resizes,
          so the fields near the bottom sat under the keyboard. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'android' ? 'padding' : undefined}
        // The avoider measures from the window's top, but this sheet starts
        // below the status bar on Android, so it under-padded by exactly that
        // inset and the last fields still sat behind the keys (#4 acceptance).
        keyboardVerticalOffset={Platform.OS === 'android' ? insets.top : 0}
        style={{ flex: 1 }}>
      <ScrollView
        ref={form}
        contentContainerStyle={{
          padding: screenPadding,
          gap: spacing.lg,
          paddingBottom: spacing.xxxl,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // Without this the keyboard covers the submit button at the end of the
        // form, which is the one control the whole screen exists to reach.
        automaticallyAdjustKeyboardInsets>
        <View
          onLayout={(event) => {
            fieldOffsets.current.address = event.nativeEvent.layout.y;
          }}
          style={{ gap: spacing.sm }}>
          <Field
            label="Name"
            placeholder="nuc"
            value={name}
            onChangeText={invalidate(setName)}
            testID="field-name"
          />
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

        <View
          onLayout={(event) => {
            fieldOffsets.current.credentials = event.nativeEvent.layout.y;
          }}
          style={{ gap: spacing.sm }}>
          <SegmentedField
            label="Authentication"
            options={[
              { value: 'password', label: 'Password' },
              { value: 'privateKey', label: 'Private key' },
            ]}
            value={authKind}
            onChange={(kind) => {
              Keyboard.dismiss();
              invalidate(setAuthKind)(kind);
            }}
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

        <View
          onLayout={(event) => {
            fieldOffsets.current.path = event.nativeEvent.layout.y;
          }}>
          <Field
            label="herdr path"
            value={herdrPath}
            onChangeText={invalidate(setHerdrPath)}
            autoCapitalize="none"
            testID="field-herdr-path"
          />
        </View>

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
            Leave empty unless this machine runs more than one herdr session. The name is what
            `herdr session list` shows.
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
                Connected. herdr {test.version ?? 'is answering'}.
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
                {connectionRecovery(test.code).title}
              </Text>
              <Text variant="footnote" color="secondary">
                {test.message}
              </Text>
              <Button
                title={installing ? 'Working…' : connectionRecovery(test.code).label}
                variant="tinted"
                loading={installing}
                onPress={() => void recover(connectionRecovery(test.code).action)}
                testID="connection-recovery"
              />
            </View>
          )}

          {test.kind === 'keyChanged' && (
            <KeyChangedPanel message={test.message} presented={test.presented} saved={storedPin} onTrust={trustNewKey} />
          )}

          {/* Shown once there is something true to show: a key a test just
              accepted, or the pin this host is already bound to. */}
          {fingerprint !== null && test.kind !== 'keyChanged' && <HostFingerprint fingerprint={fingerprint} />}

          <Button
            title="Save"
            onPress={() => void save()}
            disabled={test.kind !== 'ok'}
            testID="save-server"
          />
          {test.kind !== 'ok' && (
            <Text variant="caption" color="secondary" style={{ textAlign: 'center' }}>
              Test the connection before saving, so a typo doesn’t become a chat list that silently
              fails to load.
            </Text>
          )}
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
