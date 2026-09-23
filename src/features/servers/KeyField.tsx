import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Field } from '@/components/Field';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, spacing } from '@/theme/tokens';

/**
 * The private key field, which stops showing the key once it is entered.
 *
 * It used to stay on screen in full, where anyone nearby could read it and
 * every screenshot of the form carried it; both acceptance passes flagged it
 * (#4). While focused it is an ordinary text area, so pasting and fixing a
 * key work as before. Out of focus it is a one-line summary, and Replace
 * clears it for a new one rather than revealing the old.
 */
export function KeyField({ value, onChangeText }: { value: string; onChangeText: (text: string) => void }) {
  const { colors } = useTheme();
  const [editing, setEditing] = useState(false);

  if (value.length > 0 && !editing) {
    return (
      <View style={{ gap: spacing.sm }}>
        <Text variant="footnote" color="secondary">
          OpenSSH private key
        </Text>
        <Pressable
          onPress={() => {
            onChangeText('');
            setEditing(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={`${describeKey(value)}. Replace it.`}
          testID="field-secret-summary"
          style={{
            minHeight: minTouchTarget,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            paddingHorizontal: spacing.md,
            borderRadius: radius.sm,
            backgroundColor: colors.secondarySystemBackground,
          }}>
          <Text variant="body" style={{ flex: 1 }}>
            {describeKey(value)}
          </Text>
          <Text variant="body" color="tint">
            Replace
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Field
      label="OpenSSH private key"
      placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n…'}
      value={value}
      onChangeText={onChangeText}
      onFocus={() => setEditing(true)}
      onBlur={() => setEditing(false)}
      autoFocus={editing}
      multiline
      mono
      autoCapitalize="none"
      testID="field-secret"
    />
  );
}

/** What kind of key this looks like, and how much of it there is, never its content. */
export function describeKey(pem: string): string {
  const kind = /BEGIN OPENSSH PRIVATE KEY/.test(pem)
    ? 'OpenSSH private key'
    : /BEGIN RSA PRIVATE KEY/.test(pem)
      ? 'RSA private key'
      : /BEGIN (EC|ENCRYPTED)? ?PRIVATE KEY/.test(pem)
        ? 'Private key'
        : 'Key text';
  const lines = pem.trim().split('\n').length;
  return `${kind}, ${lines} ${lines === 1 ? 'line' : 'lines'}`;
}
