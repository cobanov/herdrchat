import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Field, SegmentedField } from '@/components/Field';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { openChat } from '@/features/chats/navigation';
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  permissionModeCopy,
  type PermissionMode,
} from '@/lib/herdr/permissionMode';
import { clientFor, useSelectedConnection } from '@/state/connections';
import { useNewChatDraft } from '@/state/newChatDraft';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, spacing } from '@/theme/tokens';

import { useRemembered, useStartChat, type NewChatAgent } from './useNewChat';

const AGENTS: readonly { value: NewChatAgent; label: string }[] = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
];

/**
 * Start a new conversation: create a workspace on the host at a chosen working
 * directory and launch Claude Code or Codex in it.
 */
export default function NewChatScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const connection = useSelectedConnection();
  const pickedCwd = useNewChatDraft((state) => state.pickedCwd);
  const clearPicked = useNewChatDraft((state) => state.clear);

  // What the last chat on this host used, once loaded. Kept separate from the
  // edited values so a slow read can never clobber typing.
  const remembered = useRemembered(connection?.id ?? null);
  const [editedCwd, setEditedCwd] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [editedMode, setEditedMode] = useState<PermissionMode | null>(null);
  const [editedAgent, setEditedAgent] = useState<NewChatAgent | null>(null);

  // Precedence: what you just picked in the folder browser, then what you typed,
  // then what this host used last. Picking clears the typed value so the
  // browser's answer is not shadowed by a stale draft.
  const cwd = pickedCwd ?? editedCwd ?? remembered?.cwd ?? '';
  const setCwd = (next: string) => {
    clearPicked();
    setEditedCwd(next);
  };
  const mode = editedMode ?? remembered?.mode ?? DEFAULT_PERMISSION_MODE;
  const agent = editedAgent ?? remembered?.agent ?? 'claude';
  const { start, creating, error } = useStartChat(connection?.id ?? null);

  const onStart = async () => {
    if (connection === null) return;
    const directory = cwd.trim();
    if (directory.length === 0) return;
    const creation = await start(clientFor(connection), {
      directory,
      label: label.trim(),
      agent,
      mode,
    });
    if (creation === null) return;
    clearPicked();
    router.dismissAll();
    openChat(connection.id, creation.workspace.workspaceId, creation.workspace.label);
  };

  const option = (selected: boolean) => ({
    padding: spacing.md,
    borderRadius: radius.sm,
    gap: spacing.xxs,
    backgroundColor: selected ? colors.tintMuted : colors.secondarySystemBackground,
  });

  return (
    <Screen presentation="sheet">
      {/* Cancel, not Done, as on the host form: this control drops the sheet
          without starting anything, and "Done" read as the way to start. */}
      <Header title="New chat" onClose={() => router.back()} closeLabel="Cancel" />

      {/* Android has no automaticallyAdjustKeyboardInsets and, edge to edge,
          no window resize, so the footer would sit behind the keys. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'android' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'android' ? insets.top : 0}
        style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ padding: screenPadding, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets>
        <View style={{ gap: spacing.sm }}>
          <Field
            label="Working directory"
            placeholder="/Users/…/project"
            value={cwd}
            onChangeText={setCwd}
            autoCapitalize="none"
            mono
            testID="field-cwd"
          />
          <Button
            title="Choose folder on the host"
            variant="tinted"
            onPress={() => router.push({ pathname: '/folder-picker', params: { start: cwd } })}
            testID="choose-folder"
          />
        </View>

        <Field
          label="Name (optional)"
          placeholder="Automatic (folder name)"
          value={label}
          onChangeText={setLabel}
          testID="field-label"
        />

        {/* #114: Codex chats were fully supported once running, but could only
            be started on the host. Two choices with nothing to explain fit one
            line; the permission modes below keep their descriptions. */}
        <SegmentedField label="Agent" options={AGENTS} value={agent} onChange={setEditedAgent} />

        {agent === 'claude' && (
          <View style={{ gap: spacing.sm }} accessibilityRole="radiogroup">
            <Text variant="footnote" color="secondary">
              Permissions
            </Text>
            {PERMISSION_MODES.map((choice) => {
              const copy = permissionModeCopy(choice);
              const selected = choice === mode;
              return (
                <Pressable
                  key={choice}
                  onPress={() => setEditedMode(choice)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${copy.title}. ${copy.detail}`}
                  testID={`permission-${choice}`}
                  style={option(selected)}>
                  <Text variant="headline" color={selected ? 'tint' : 'label'}>
                    {copy.title}
                  </Text>
                  <Text variant="footnote" color="secondary">
                    {copy.detail}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {agent === 'codex' && (
          <Text variant="caption" color="secondary">
            Codex reports its session after your first message.
          </Text>
        )}

      </ScrollView>

      {/* Start is pinned below the form rather than at its end, for the reason
          the host form's Save is: at the end it sat under the fold, and the
          only control in sight was the header's. */}
      <View
        style={{
          paddingHorizontal: screenPadding,
          paddingTop: spacing.md,
          paddingBottom: Math.max(insets.bottom, spacing.lg),
          gap: spacing.sm,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.separator,
          backgroundColor: colors.systemBackground,
        }}>
        {/* Beside the button that failed, not at the end of the form, where it
            opened below the fold. */}
        {error !== null && (
          <Text variant="footnote" color="attention" style={{ textAlign: 'center' }} testID="new-chat-error">
            {error}
          </Text>
        )}
        <Button
          title={creating ? 'Starting…' : agent === 'codex' ? 'Start Codex' : 'Start Claude Code'}
          onPress={() => void onStart()}
          loading={creating}
          disabled={cwd.trim().length === 0}
          testID="start-chat"
        />
        {cwd.trim().length === 0 && (
          <Text variant="caption" color="secondary" style={{ textAlign: 'center' }}>
            Start turns on once there is a working directory.
          </Text>
        )}
      </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
