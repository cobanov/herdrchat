import { Keyboard, View } from 'react-native';

import { Field, FieldRow, SegmentedField } from '@/components/Field';
import { Text } from '@/components/Text';
import { KeyField } from '@/features/servers/KeyField';
import type { HostForm } from '@/features/servers/useHostForm';
import { size, spacing } from '@/theme/tokens';

/** A block of the form that a recovery can scroll to. */
export type HostSection = 'address' | 'credentials' | 'path';

/** The host editor's fields: where it is, how to log in, and which herdr. */
export function HostFields({ form, isNew, onSectionLayout, onKeyFocus }: {
  form: HostForm;
  isNew: boolean;
  /** Where each block sits in the form, for a recovery to scroll to. */
  onSectionLayout: (section: HostSection, y: number) => void;
  /** The private key took focus. */
  onKeyFocus: () => void;
}) {
  const { values, set } = form;
  return (
    <>
      <View onLayout={(event) => onSectionLayout('address', event.nativeEvent.layout.y)} style={{ gap: spacing.sm }}>
        <Field label="Name" placeholder="nuc" value={values.name} onChangeText={set.name} testID="field-name" />
        <FieldRow weights={size.hostPortWeights}>
          <Field
            label="Host"
            placeholder="100.x.y.z or a name"
            value={values.host}
            onChangeText={set.host}
            autoCapitalize="none"
            testID="field-host"
          />
          <Field label="Port" value={values.port} onChangeText={set.port} keyboardType="number-pad" testID="field-port" />
        </FieldRow>
        <Field
          label="Username"
          value={values.username}
          onChangeText={set.username}
          autoCapitalize="none"
          testID="field-username"
        />
      </View>

      <View onLayout={(event) => onSectionLayout('credentials', event.nativeEvent.layout.y)} style={{ gap: spacing.sm }}>
        <SegmentedField
          label="Authentication"
          options={[
            { value: 'password', label: 'Password' },
            { value: 'privateKey', label: 'Private key' },
          ]}
          value={values.authKind}
          onChange={(kind) => {
            Keyboard.dismiss();
            set.authKind(kind);
          }}
        />
        {values.authKind === 'privateKey' ? (
          <>
            <KeyField
              value={values.secret}
              onChangeText={set.secret}
              // The key is several lines tall, so the inset alone can leave its
              // top under the keyboard; bring the whole credentials block up.
              onFocus={onKeyFocus}
            />
            <Field
              label="Passphrase"
              placeholder={isNew ? 'None' : 'Unchanged'}
              value={values.passphrase}
              onChangeText={set.passphrase}
              secureTextEntry
              autoCapitalize="none"
              testID="field-passphrase"
            />
          </>
        ) : (
          <Field
            label="Password"
            value={values.secret}
            onChangeText={set.secret}
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

      {/* Blank session is the common case and the right default. Naming one
          only matters on a host running more than one, where we previously
          drove whichever the default resolved to without saying so. */}
      <View onLayout={(event) => onSectionLayout('path', event.nativeEvent.layout.y)} style={{ gap: spacing.sm }}>
        <FieldRow>
          <Field
            label="herdr path"
            value={values.herdrPath}
            onChangeText={set.herdrPath}
            autoCapitalize="none"
            testID="field-herdr-path"
          />
          <Field
            label="herdr session"
            placeholder="Default"
            value={values.sessionName}
            onChangeText={set.sessionName}
            autoCapitalize="none"
            testID="field-session"
          />
        </FieldRow>
        <Text variant="caption" color="secondary">
          Leave the session empty unless this machine runs more than one herdr session.
        </Text>
      </View>
    </>
  );
}
