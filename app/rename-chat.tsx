import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { errorText } from '@/features/chats/useWorkspaces';
import { haptics } from '@/lib/haptics';
import { useChatEdits } from '@/state/chatEdits';
import { clientFor, useSelectedConnection } from '@/state/connections';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, screenPadding, spacing } from '@/theme/tokens';

/**
 * Rename a chat.
 *
 * A presented sheet rather than `Alert.prompt`, which is what this replaced.
 * That API is iOS-only — Android had no rename at all, silently — and it offers
 * no control over what happens when the keyboard comes up, which is the one
 * thing a single-field form has to get right.
 *
 * SIZED TO ITS CONTENT, and laid out as a sheet rather than as a screen. The
 * first version reused `Header`, whose large title and screen-height rhythm are
 * built for a full page, inside a sheet pinned to 40% of the display — with the
 * keyboard up there was almost nothing left to see. A sheet this small wants a
 * compact title row, its actions on that row where the thumb already is, and no
 * scroll view pretending there is somewhere to scroll.
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
  const canSave = trimmed.length > 0 && !unchanged && !saving;

  const save = async () => {
    if (connection === null || !canSave) return;
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
      <View style={{ padding: screenPadding, gap: spacing.lg }}>
        {/* Cancel / title / Save on one line, the way a system sheet does it.
            Both actions sit at the top because the bottom of a keyboard-raised
            sheet is the keyboard. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: minTouchTarget }}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            hitSlop={spacing.sm}
            testID="rename-cancel">
            <Text variant="body" color="tint">
              Cancel
            </Text>
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text variant="headline">Rename chat</Text>
          </View>
          {/* Same width as Cancel would be, so the title stays optically centred
              whether Save is enabled or not. */}
          <Pressable
            onPress={() => void save()}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityLabel="Save"
            accessibilityState={{ disabled: !canSave }}
            hitSlop={spacing.sm}
            testID="save-rename">
            <Text variant="body" weight="600" color={canSave ? 'tint' : 'tertiary'}>
              {saving ? 'Saving…' : 'Save'}
            </Text>
          </Pressable>
        </View>

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
      </View>
    </Screen>
  );
}
