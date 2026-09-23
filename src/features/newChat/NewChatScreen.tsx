import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
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

const AGENTS: readonly { id: NewChatAgent; title: string; detail: string }[] = [
  { id: 'claude', title: 'Claude Code', detail: 'Starts Claude with the permission mode below.' },
  {
    id: 'codex',
    title: 'Codex',
    detail: 'Starts Codex. Its session is reported after your first message.',
  },
];

/**
 * Start a new conversation: create a workspace on the host at a chosen working
 * directory and launch Claude Code or Codex in it.
 */
export default function NewChatScreen() {
  const router = useRouter();
  const { colors } = useTheme();
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
      <Header title="New chat" onClose={() => router.back()} />

      <ScrollView
        contentContainerStyle={{ padding: screenPadding, gap: spacing.lg, paddingBottom: spacing.xxxl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        // Without this the keyboard covers the submit button at the end of the
        // form, which is the one control the whole screen exists to reach.
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
          <Text variant="caption" color="secondary">
            The agent starts in this directory. Type a path, or browse the host’s folders to pick one.
          </Text>
        </View>

        {/* #114: Codex chats were fully supported once running, but could only
            be started on the host. */}
        <View style={{ gap: spacing.sm }} accessibilityRole="radiogroup">
          <Text variant="footnote" color="secondary">
            Agent
          </Text>
          {AGENTS.map((choice) => {
            const selected = choice.id === agent;
            return (
              <Pressable
                key={choice.id}
                onPress={() => setEditedAgent(choice.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${choice.title}. ${choice.detail}`}
                testID={`agent-${choice.id}`}
                style={option(selected)}>
                <Text variant="headline" color={selected ? 'tint' : 'label'}>
                  {choice.title}
                </Text>
                <Text variant="footnote" color="secondary">
                  {choice.detail}
                </Text>
              </Pressable>
            );
          })}
        </View>

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

        <Field
          label="Name (optional)"
          placeholder="Automatic (folder name)"
          value={label}
          onChangeText={setLabel}
          testID="field-label"
        />

        {error !== null && (
          <View style={{ padding: spacing.md, borderRadius: radius.sm, backgroundColor: colors.fillSubtle }}>
            <Text variant="footnote" color="secondary">
              {error}
            </Text>
          </View>
        )}

        <Button
          title="Start"
          onPress={() => void onStart()}
          loading={creating}
          disabled={cwd.trim().length === 0}
          testID="start-chat"
        />
      </ScrollView>
    </Screen>
  );
}
