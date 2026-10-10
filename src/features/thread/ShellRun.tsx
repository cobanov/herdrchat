import * as Clipboard from 'expo-clipboard';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { showActionSheet, type SheetAction } from '@/components/ActionSheet';
import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import { foldShellOutput, shellOutputText } from '@/lib/shellMode';
import type { ShellItem } from '@/lib/threadItems';
import { useToolRuns } from '@/state/toolRuns';
import { useTheme } from '@/theme/ThemeProvider';
import { motion, radius, shellPrompt, size, spacing } from '@/theme/tokens';

/**
 * A line run in the agent's shell (`! git status`) and what it printed.
 *
 * A terminal exchange, not a message: the command in a mono header after a
 * prompt, the output under it in a mono box, stderr after stdout in the
 * attention colour. Centred and full width like a command's note, since
 * neither side said it; the person ran it, so it carries their time.
 *
 * Long output folds to `size.shellOutputLines` with "Show all N lines", kept
 * open by key in `useToolRuns` because FlashList recycles rows. A long press
 * copies the output or the command; the press is the native recognizer, not
 * a Pressable, for the reason `Bubble` gives.
 */
export function ShellRun({ item, timeLabel }: { item: ShellItem; timeLabel: string | null }) {
  const { colors } = useTheme();
  const foldKey = `shell:${item.key}`;
  const open = useToolRuns((state) => state.open[foldKey] ?? false);
  const toggle = useToolRuns((state) => state.toggle);
  const fold = foldShellOutput(item.stdout, item.stderr, size.shellOutputLines, open);
  const empty = fold.lines === 0;
  const foldable = fold.lines > size.shellOutputLines;

  const copy = useCallback(() => {
    const output = shellOutputText(item.stdout, item.stderr);
    const actions: SheetAction[] = [];
    const put = (text: string) => () => {
      void Clipboard.setStringAsync(text);
      haptics.success();
    };
    if (output.length > 0) actions.push({ label: 'Copy output', onPress: put(output) });
    if (item.command !== null) actions.push({ label: 'Copy command', onPress: put(item.command) });
    if (actions.length === 0) return;
    haptics.medium();
    showActionSheet({ title: 'Shell command', actions });
  }, [item.stdout, item.stderr, item.command]);

  const longPress = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(motion.longPress)
        .runOnJS(true)
        .withTestId(`shell-long-press-${item.key}`)
        .onStart(() => copy()),
    [copy, item.key]
  );

  // Printed nothing, or never said: an interrupted command's output turn was never written.
  const emptyLabel = item.recorded ? 'No output' : 'No output recorded';
  const state = item.running
    ? 'running'
    : empty ? emptyLabel.toLowerCase() : `${fold.lines} ${fold.lines === 1 ? 'line' : 'lines'} of output`;

  return (
    <GestureDetector gesture={longPress}>
      <View
        testID={`shell-run-${item.key}`}
        style={{
          alignSelf: 'stretch',
          borderRadius: radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.separator,
          overflow: 'hidden',
        }}>
        <View
          accessible
          accessibilityRole="text"
          accessibilityLabel={`Shell command: ${item.command ?? 'output'}, ${state}${timeLabel !== null ? `, ${timeLabel}` : ''}`}
          accessibilityHint="Long press to copy"
          accessibilityActions={[{ name: 'longpress', label: 'Copy' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'longpress') copy();
          }}
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: spacing.sm,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          }}>
          <Text variant="footnote" mono color="tertiary">
            {shellPrompt}
          </Text>
          <Text testID="shell-command" variant="footnote" mono weight="600" color={item.command === null ? 'secondary' : 'label'} style={{ flex: 1 }}>
            {item.command ?? 'Output'}
          </Text>
          {timeLabel !== null && (
            <Text variant="caption2" color="tertiary">
              {timeLabel}
            </Text>
          )}
        </View>

        <View style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs, backgroundColor: colors.fillSubtle }}>
          {item.running ? (
            <View testID="shell-running" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <ActivityIndicator size="small" color={colors.tertiaryLabel} />
              <Text variant="caption" color="secondary">
                Running
              </Text>
            </View>
          ) : empty ? (
            <Text testID="shell-empty" variant="caption" color="tertiary">
              {emptyLabel}
            </Text>
          ) : (
            <Text testID="shell-output" variant="caption" mono>
              {fold.stdout}
              {fold.stderr.length > 0 && (
                <Text testID="shell-stderr" variant="caption" mono color="attention">
                  {fold.stdout.length > 0 ? `\n${fold.stderr}` : fold.stderr}
                </Text>
              )}
            </Text>
          )}
          {foldable && !item.running && (
            <Pressable
              testID="shell-show-all"
              onPress={() => {
                haptics.selection();
                toggle(foldKey, open);
              }}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              hitSlop={spacing.sm}>
              <Text variant="caption" weight="600" color="tint">
                {open ? 'Show less' : `Show all ${fold.lines} lines`}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </GestureDetector>
  );
}
