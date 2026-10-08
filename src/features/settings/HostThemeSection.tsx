import * as Clipboard from 'expo-clipboard';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { confirmDestructive } from '@/components/ActionSheet';
import { Icon } from '@/components/Icon';
import { ActionRow, Divider, ROW_INSET, Section } from '@/components/SettingsList';
import { Text } from '@/components/Text';
import { Toggle } from '@/components/Toggle';
import { haptics } from '@/lib/haptics';
import { AGENT_PROMPT } from '@/lib/theme/bootstrap';
import { THEME_PATH_DISPLAY } from '@/lib/theme/schema';
import { useSelectedConnection } from '@/state/connections';
import { useHostTheme } from '@/state/hostTheme';
import { reloadHostTheme, resetHostThemeToDefault } from '@/state/hostThemeActions';
import { saveSetting } from '@/state/saveSetting';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, size, spacing } from '@/theme/tokens';
import { hostThemeSummary } from './hostThemeSummary';

/**
 * The selected host's theme.json: what it applies, what it got wrong, and the
 * three things a person does about it.
 *
 * The row folds the detail away because most people never open it: the value
 * already says which theme is on, and the problems are the only reason to look
 * further. Inline rather than a pushed screen, so Reload sits next to the
 * line it changes.
 */
export function HostThemeSection() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const enabled = useSettings((state) => state.useHostThemes);
  const connection = useSelectedConnection();
  const theme = useHostTheme((state) => (connection === null ? undefined : state.byConnection[connection.id]));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const hostName = connection === null ? 'the host' : connection.name || connection.host;
  const summary = hostThemeSummary(enabled, theme, hostName);

  const run = async (action: (connectionId: string) => Promise<boolean>) => {
    if (connection === null) return;
    setBusy(true);
    setNote(null);
    const answered = await action(connection.id);
    setBusy(false);
    if (answered) {
      haptics.success();
    } else {
      haptics.error();
      setNote(`${hostName} did not answer. The theme is unchanged; try again when it is reachable.`);
    }
  };

  const reset = () => {
    confirmDestructive({
      title: 'Use the default theme?',
      message: `theme.json on ${hostName} is renamed to theme.json.bak, not deleted. Rename it back to restore it.`,
      confirmLabel: 'Use the default theme',
      onConfirm: () => void run(resetHostThemeToDefault),
    });
  };

  const copyPrompt = () => {
    void Clipboard.setStringAsync(AGENT_PROMPT);
    haptics.success();
    setCopied(true);
  };

  const label = summary.detail === null ? `Host theme, ${summary.value}` : `Host theme, ${summary.value}, ${summary.detail}`;

  return (
    <Section
      title="Theme"
      footer="Each host can restyle the app with a theme.json of its own, which applies while that host is selected. Ask an agent there to write it.">
      <Pressable
        onPress={() => setOpen((value) => !value)}
        disabled={connection === null}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        testID="host-theme-row"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingHorizontal: ROW_INSET,
          paddingVertical: spacing.sm,
          minHeight: minTouchTarget,
          backgroundColor: pressed ? colors.fillSubtle : 'transparent',
        })}>
        <View style={{ flex: 1, gap: spacing.xxs }}>
          <Text variant="body">Host theme</Text>
          {summary.detail !== null && (
            <Text variant="footnote" color={summary.attention ? 'attention' : 'secondary'}>
              {summary.detail}
            </Text>
          )}
        </View>
        <Text variant="body" color="secondary" numberOfLines={1} style={{ flexShrink: 1, textAlign: 'right' }}>
          {summary.value}
        </Text>
        <Icon
          name={open ? 'chevron.down' : 'chevron.right'}
          size={size.rowChevron}
          tintColor={colors.tertiaryLabel}
          fallback={<Text variant="caption" color="tertiary">{open ? '⌄' : '›'}</Text>}
        />
      </Pressable>

      {open && connection !== null && <>
        <View style={{ paddingHorizontal: ROW_INSET, paddingBottom: spacing.sm, gap: spacing.xs }}>
          <Text variant="footnote" color="secondary" selectable>
            {THEME_PATH_DISPLAY} on {hostName}
          </Text>
          {/* Verbatim, one per line: each names the key and what was wrong
              with it, which is what the person (or their agent) fixes. */}
          {theme?.problems.map((problem) => (
            <Text key={problem} variant="footnote" color="attention" selectable>
              {problem}
            </Text>
          ))}
          {note !== null && (
            <Text variant="footnote" color="secondary">
              {note}
            </Text>
          )}
        </View>
        <Divider />
        <ActionRow
          label="Reload theme"
          detail="Read theme.json now instead of at the next check."
          tone="tint"
          accessory="none"
          disabled={busy}
          onPress={() => void run(reloadHostTheme)}
          testID="host-theme-reload"
        />
        <Divider />
        <ActionRow
          label={copied ? 'Copied' : 'Copy prompt for an agent'}
          detail={copied ? 'Paste it to an agent on this host, then say what you would like.' : 'Points it at the file, the schema and the contrast rule.'}
          tone="tint"
          accessory="none"
          onPress={copyPrompt}
          testID="host-theme-copy"
        />
        <Divider />
        <ActionRow
          label="Reset to default"
          detail="Renames theme.json to theme.json.bak on the host."
          tone="destructive"
          accessory="none"
          disabled={busy}
          onPress={reset}
          testID="host-theme-reset"
        />
      </>}

      <Divider />
      <Toggle
        label="Use host themes"
        detail="Off draws the app's own colours and leaves every host's file alone."
        value={enabled}
        onChange={(next) => saveSetting(db, 'useHostThemes', next)}
        testID="toggle-host-themes"
      />
    </Section>
  );
}
