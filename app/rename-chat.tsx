import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { errorText } from '@/features/chats/useWorkspaces';
import { haptics } from '@/lib/haptics';
import { useChatEdits } from '@/state/chatEdits';
import { clientFor, useSelectedConnection } from '@/state/connections';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, spacing } from '@/theme/tokens';

/**
 * Rename a chat.
 *
 * A presented screen rather than `Alert.prompt`, which is what this replaced.
 * That API is iOS-only — Android had no rename at all, silently — and it offers
 * no control over what happens when the keyboard comes up, which is the one
 * thing a single-field form has to get right.
 *
 * The rename happens here rather than being handed back to the list. herdr may
 * normalise or reject a label, so the host is the only thing that knows the
 * resulting name; the list is told to re-fetch rather than told what to draw.
 */
export default function RenameChatScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const connection = useSelectedConnection();
  const markDirty = useChatEdits((state) => state.markDirty);
  const params = useLocalSearchParams<{ workspaceId: string; title?: string }>();

  const original = params.title ?? '';
  const [label, setLabel] = useState(original);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = label.trim();
  const unchanged = trimmed === original.trim();

  const save = async () => {
    if (connection === null || trimmed.length === 0 || unchanged) return;
    setSaving(true);
    setError(null);
    try {
      await clientFor(connection).renameWorkspace(params.workspaceId, trimmed);
      haptics.success();
      markDirty();
      router.back();
    } catch (thrown) {
      haptics.error();
      setError(errorText(thrown));
      setSaving(false);
    }
  };

  return (
    <Screen presentation="sheet">
      <Header title="Rename chat" onClose={() => router.back()} />

      <ScrollView
        contentContainerStyle={{ padding: screenPadding, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
        // The form is one field and one button. Without this the keyboard covers
        // the button, which on a screen this short is most of the screen.
        automaticallyAdjustKeyboardInsets>
        <Field
          label="Name"
          value={label}
          onChangeText={setLabel}
          placeholder={original}
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
          onSubmitEditing={() => void save()}
          testID="field-rename"
        />

        <Text variant="caption" color="secondary">
          This renames the workspace on {connection?.name ?? 'the host'}, not just
          here — herdr shows the new name too.
        </Text>

        {error !== null && (
          <View
            style={{
              padding: spacing.md,
              borderRadius: radius.sm,
              backgroundColor: colors.fillSubtle,
            }}>
            <Text variant="footnote" color="secondary">
              {error}
            </Text>
          </View>
        )}

        <Button
          title="Save"
          onPress={() => void save()}
          loading={saving}
          disabled={trimmed.length === 0 || unchanged}
          testID="save-rename"
        />
      </ScrollView>
    </Screen>
  );
}
