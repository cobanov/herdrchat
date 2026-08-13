import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { agentName } from '@/lib/herdr/agentName';
import { HerdrError } from '@/lib/herdr/protocol';
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  isPermissionMode,
  launchCommand,
  permissionModeCopy,
  type PermissionMode,
} from '@/lib/herdr/permissionMode';
import { clientFor, useSelectedConnection } from '@/state/connections';
import { getSetting, setSetting } from '@/state/db';
import { useNewChatDraft } from '@/state/newChatDraft';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, spacing } from '@/theme/tokens';

/**
 * Start a new conversation: create a workspace on the host at a chosen working
 * directory and launch Claude in it.
 */
export default function NewChatScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const connection = useSelectedConnection();
  const pickedCwd = useNewChatDraft((state) => state.pickedCwd);
  const clearPicked = useNewChatDraft((state) => state.clear);

  // What the last chat on this connection used, once loaded. Kept separate from
  // the edited value so a slow keychain read can never clobber typing.
  const [remembered, setRemembered] = useState<{ cwd: string; mode: PermissionMode } | null>(null);
  const [editedCwd, setEditedCwd] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [editedMode, setEditedMode] = useState<PermissionMode | null>(null);

  // Precedence: what you just picked in the folder browser, then what you typed,
  // then what this connection used last. Picking clears the typed value so the
  // browser's answer is not shadowed by a stale draft.
  const cwd = pickedCwd ?? editedCwd ?? remembered?.cwd ?? '';
  const setCwd = (next: string) => {
    clearPicked();
    setEditedCwd(next);
  };
  const mode = editedMode ?? remembered?.mode ?? DEFAULT_PERMISSION_MODE;
  const setMode = setEditedMode;
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settingKey = (name: string) => `${name}.${connection?.id ?? 'none'}`;

  // Remembered per connection, so repeat use is one tap. Both values land in a
  // single update: two synchronous setStates inside an effect body is what makes
  // a form flicker through an intermediate state on open.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [lastCwd, lastMode] = await Promise.all([
        getSetting(db, settingKey('lastCwd')),
        getSetting(db, settingKey('permissionMode')),
      ]);
      if (cancelled) return;
      setRemembered({
        cwd: lastCwd ?? '',
        mode: isPermissionMode(lastMode) ? lastMode : DEFAULT_PERMISSION_MODE,
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, connection?.id]);

  const start = async () => {
    if (connection === null) return;
    const directory = cwd.trim();
    if (directory.length === 0) return;

    setCreating(true);
    setError(null);
    try {
      const client = await clientFor(connection);
      const creation = await client.createWorkspace(
        directory,
        label.trim().length === 0 ? null : label.trim()
      );
      // Named after the workspace, so `herdr agent list` on the desktop shows
      // the same thing this app calls the chat. On a host without `agent start`
      // this falls back to typing the launch command, which is what shipped.
      await client.startNamedAgent(
        creation.rootPane.paneId,
        agentName(creation.workspace.label),
        'claude',
        launchCommand(mode)
      );
      await setSetting(db, settingKey('lastCwd'), directory);
      await setSetting(db, settingKey('permissionMode'), mode);

      clearPicked();
      router.dismissAll();
      router.push({
        pathname: '/chat/[workspaceId]',
        params: {
          workspaceId: creation.workspace.workspaceId,
          title: creation.workspace.label,
        },
      });
    } catch (thrown) {
      setError(thrown instanceof HerdrError ? thrown.message : String(thrown));
      setCreating(false);
    }
  };

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
            Claude starts in this directory. Type a path, or browse the host’s folders to pick one.
          </Text>
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text variant="footnote" color="secondary">
            Permissions
          </Text>
          {PERMISSION_MODES.map((option) => {
            const copy = permissionModeCopy(option);
            const selected = option === mode;
            return (
              <Pressable
                key={option}
                onPress={() => setMode(option)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${copy.title}. ${copy.detail}`}
                testID={`permission-${option}`}
                style={{
                  padding: spacing.md,
                  borderRadius: radius.sm,
                  gap: spacing.xxs,
                  backgroundColor: selected ? colors.tintMuted : colors.secondarySystemBackground,
                }}>
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
          onPress={() => void start()}
          loading={creating}
          disabled={cwd.trim().length === 0}
          testID="start-chat"
        />
      </ScrollView>
    </Screen>
  );
}
