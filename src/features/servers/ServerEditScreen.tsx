import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { confirmDestructive } from '@/components/ActionSheet';
import { Button } from '@/components/Button';
import { FieldRow } from '@/components/Field';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { SheetFooter } from '@/components/SheetFooter';
import { Text } from '@/components/Text';
import { HostFields, type HostSection } from '@/features/servers/HostFields';
import { useHostForm } from '@/features/servers/useHostForm';
import { errorText, HerdrError, type HerdrErrorCode } from '@/lib/herdr/protocol';
import { connectionRecovery, type RecoveryAction } from '@/lib/connectionRecovery';
import { HostFingerprint, KeyChangedPanel } from '@/features/servers/HostKeyPanels';
import { shouldResetPin } from '@/lib/hostkey';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, spacing } from '@/theme/tokens';
import {
  clearSecrets,
  invalidateClient,
  loadHostKeyPin,
  loadPassphrase,
  loadSecret,
  saveHostKeyPin,
  savePassphrase,
  saveSecret,
  testClient,
  useConnections,
} from '@/state/connections';
import { saveConnection, setSetting } from '@/state/db';
import { SELECTED_KEY } from '@/state/Hydrate';

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  /** `live` is false on a host with no socket bridge: chats work on the CLI path, polled, with no live events (#158). */
  | { kind: 'ok'; version: string | null; live: boolean }
  | { kind: 'failed'; message: string; code: HerdrErrorCode }
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

  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  // What the passing test's connection actually accepted; save() persists it
  // when the endpoint changed, so the pin is always a key we presented
  // credentials to, never whoever answers the next connect.
  const [observedFingerprint, setObservedFingerprint] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The pin this host is already bound to, for the reader to compare against
  // `ssh-keygen -lf` on the machine itself. Read once: it only changes through
  // the flows on this screen, which set `observedFingerprint` anyway.
  const [storedPin, setStoredPin] = useState<string | null>(null);
  const form = useRef<ScrollView>(null);
  const fieldOffsets = useRef<Record<HostSection, number>>({ address: 0, credentials: 0, path: 0 });
  const testAttempt = useRef(0);
  const fields = useHostForm(params.id, existing, () => {
    testAttempt.current += 1;
    setTest({ kind: 'idle' });
  });
  const { draft } = fields;
  const { secret, passphrase } = fields.values;
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


  /**
   * A new key brings its own passphrase, blank for none. A kept key keeps its
   * stored one unless another is typed.
   */
  const resolvePassphrase = async (): Promise<string | null> => {
    if (passphrase.length > 0 || secret.length > 0) return passphrase;
    return loadPassphrase(params.id);
  };

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
        passphrase: await resolvePassphrase(),
      }
    );
    try {
      await client.ping();
      const snapshot = await client.snapshot();
      // Memoised by the client, so after the snapshot this costs nothing more.
      const live = (await client.socket.detect()) !== null;
      if (attempt === testAttempt.current) setTest({ kind: 'ok', version: snapshot.version, live });
    } catch (thrown) {
      if (attempt !== testAttempt.current) return;
      const failure = thrown instanceof HerdrError ? thrown : null;
      if (failure?.code === 'host_key_changed') {
        setTest({ kind: 'keyChanged', message: failure.message, presented: failure.presentedFingerprint });
      } else {
        setTest({ kind: 'failed', message: errorText(thrown), code: failure?.code ?? 'unknown' });
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
        passphrase: await resolvePassphrase(),
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
        message: errorText(thrown),
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
        passphrase: await resolvePassphrase(),
      }
    );
    try {
      await client.startServer();
      await runTest();
    } catch (thrown) {
      setTest({
        kind: 'failed',
        message: errorText(thrown),
        code: thrown instanceof HerdrError ? thrown.code : 'unknown',
      });
    } finally {
      await dispose();
      setInstalling(false);
    }
  };

  // A keychain or database write that failed left Save doing nothing at all.
  const save = async () => {
    setSaveError(null);
    try {
      await saveHost();
    } catch (thrown) {
      setSaveError(`Could not save this host. ${errorText(thrown)}`);
    }
  };

  const saveHost = async () => {
    const connection = draft();
    if (secret.length > 0) await saveSecret(connection.id, secret);
    if (connection.authKind === 'privateKey' && (secret.length > 0 || passphrase.length > 0)) {
      await savePassphrase(connection.id, passphrase);
    } else if (connection.authKind === 'password') {
      await savePassphrase(connection.id, '');
    }
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

  const close = () => {
    if (!fields.dirty) {
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
      {/* Cancel, not Done: this control throws the form away, and "Done" read
          as "keep it", so a filled-in host was lost by the one tap that looked
          like finishing. Saving is the button at the foot of the sheet. */}
      <Header title={isNew ? 'New host' : 'Edit host'} onClose={close} closeLabel="Cancel" />

      {/* iOS insets the form itself (automaticallyAdjustKeyboardInsets below);
          Android has no such prop, and with edge-to-edge the window no longer
          resizes, so the fields near the bottom sat under the keyboard. */}
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
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // This comment's claim above was true only here: the prop was never
        // set, so a form that fit the sheet had no room to scroll, and the
        // private key, the tallest field and the lowest, sat under the keys
        // with no way to reach it. With the inset the form can scroll the
        // keyboard's height further, and a focused key scrolls itself up.
        automaticallyAdjustKeyboardInsets>
        <HostFields
          form={fields}
          isNew={isNew}
          onSectionLayout={(section, y) => {
            fieldOffsets.current[section] = y;
          }}
          onKeyFocus={() => form.current?.scrollTo({ y: fieldOffsets.current.credentials, animated: true })}
        />

        {/* What a test found beyond a plain pass sits at the end of the form,
            and the form scrolls to it: the recovery button is the next thing to
            press, so it must not open below the fold. */}
        {test.kind === 'failed' && (
          <View
            onLayout={() => form.current?.scrollToEnd({ animated: true })}
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
          <View onLayout={() => form.current?.scrollToEnd({ animated: true })}>
            <KeyChangedPanel message={test.message} presented={test.presented} saved={storedPin} onTrust={trustNewKey} />
          </View>
        )}

        {/* Shown once there is something true to show: a key a test just
            accepted, or the pin this host is already bound to. */}
        {fingerprint !== null && test.kind !== 'keyChanged' && <HostFingerprint fingerprint={fingerprint} />}
      </ScrollView>

      {/* Test and Save are pinned below the form rather than at its end. At
          the end they sat under the fold of a long form, and the only control
          left in sight was the header's, which is how a new host got dropped
          instead of saved. */}
      <SheetFooter>
        {test.kind === 'ok' && (
          <Text variant="subhead" color="tint" weight="600" style={{ textAlign: 'center' }} testID="test-ok">
            Connected. herdr {test.version ?? 'is answering'}.
          </Text>
        )}
        {test.kind === 'ok' && !test.live && (
          <Text variant="footnote" color="secondary" style={{ textAlign: 'center' }} testID="test-no-bridge">
            No live events on this host: the app polls it instead, so updates arrive a few seconds late.
          </Text>
        )}
        {saveError !== null && (
          <Text variant="footnote" color="destructive" style={{ textAlign: 'center' }} testID="save-error">
            {saveError}
          </Text>
        )}
        <FieldRow>
          <Button
            title={test.kind === 'testing' ? 'Testing…' : 'Test connection'}
            variant="tinted"
            loading={test.kind === 'testing'}
            disabled={!fields.valid}
            onPress={() => void runTest()}
            testID="test-connection"
          />
          <Button
            title="Save"
            onPress={() => void save()}
            disabled={test.kind !== 'ok'}
            testID="save-server"
          />
        </FieldRow>
        {test.kind !== 'ok' && (
          <Text variant="caption" color="secondary" style={{ textAlign: 'center' }}>
            Save turns on once the connection test passes.
          </Text>
        )}
      </SheetFooter>
      </KeyboardAvoidingView>
    </Screen>
  );
}
