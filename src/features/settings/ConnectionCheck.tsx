import { useRouter } from 'expo-router';
import { useState } from 'react';

import { ActionRow, ROW_INSET, Section } from '@/components/SettingsList';
import { Text } from '@/components/Text';
import { connectionRecovery } from '@/lib/connectionRecovery';
import { HerdrError } from '@/lib/herdr/protocol';
import { clientFor, type ServerConnection } from '@/state/connections';
import { spacing } from '@/theme/tokens';

export function ConnectionCheck({ connection }: { connection: ServerConnection }) {
  const router = useRouter();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const test = async () => {
    setTesting(true);
    setResult(null);
    setFailed(false);
    try {
      const client = clientFor(connection);
      await client.ping();
      const snapshot = await client.snapshot();
      setResult(`Connected. herdr ${snapshot.version ?? 'is answering'}.`);
    } catch (thrown) {
      const code = thrown instanceof HerdrError ? thrown.code : 'unknown';
      setResult(
        `${connectionRecovery(code).title}. ${thrown instanceof Error ? thrown.message : String(thrown)}`
      );
      setFailed(true);
    } finally {
      setTesting(false);
    }
  };
  return (
    <Section title="Connection">
      <ActionRow
        label={testing ? 'Testing…' : 'Test connection'}
        onPress={() => {
          if (!testing) void test();
        }}
        accessory="none"
        testID="settings-test-connection"
      />
      {result !== null && (
        <Text
          variant="footnote"
          color={failed ? 'attention' : 'secondary'}
          style={{ paddingHorizontal: ROW_INSET, paddingVertical: spacing.sm }}
          testID="settings-connection-result">
          {result}
        </Text>
      )}
      {failed && (
        <ActionRow
          label="Review host settings"
          onPress={() => router.push(`/server/${connection.id}`)}
          accessory="chevron"
        />
      )}
    </Section>
  );
}
